/**
 * The spend ledger: an append-only `ledger.jsonl` in the data folder.
 *
 * Every paid call reserves its estimated cost before it is submitted, under one lock shared by
 * every process, so five posts generating at once can't all pass the daily cap. The reservation
 * is settled once the result arrives, or released if the call failed before anything was billed.
 * Providers here don't report the actual charge, so a settled amount is the estimate unless a
 * provider says otherwise.
 */

import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";
import { type Context, DEFAULT_CAPS } from "./context.ts";
import { fail, type ShortsError } from "./errors.ts";
import { acquireLock } from "./files.ts";

export interface LedgerEntry {
	readonly id: string;
	readonly at: string;
	readonly type: "reserve" | "settle" | "release";
	readonly provider: string;
	readonly model: string;
	readonly post: string;
	readonly usd: number;
	readonly requestId?: string;
	readonly note?: string;
}

const ledgerFile = (ctx: Context): string => join(ctx.paths.data, "ledger.jsonl");

export const readLedger = (ctx: Context): ReadonlyArray<LedgerEntry> => {
	const file = ledgerFile(ctx);
	if (!existsSync(file)) return [];
	return readFileSync(file, "utf8")
		.split("\n")
		.filter((line) => line.trim() !== "")
		.map((line) => JSON.parse(line) as LedgerEntry);
};

/** Current amount per reservation: its settlement if settled, 0 if released. */
const amounts = (entries: ReadonlyArray<LedgerEntry>) => {
	const byId = new Map<string, { reserve: LedgerEntry; usd: number }>();
	for (const entry of entries) {
		if (entry.type === "reserve") byId.set(entry.id, { reserve: entry, usd: entry.usd });
		else {
			const current = byId.get(entry.id);
			if (current !== undefined) current.usd = entry.type === "release" ? 0 : entry.usd;
		}
	}
	return [...byId.values()];
};

export const spent = (
	entries: ReadonlyArray<LedgerEntry>,
	filter: { readonly day?: string; readonly post?: string },
): number =>
	amounts(entries)
		.filter(({ reserve }) => filter.day === undefined || reserve.at.startsWith(filter.day))
		.filter(({ reserve }) => filter.post === undefined || reserve.post === filter.post)
		.reduce((sum, { usd }) => sum + usd, 0);

const append = (ctx: Context, entry: LedgerEntry): void => {
	mkdirSync(ctx.paths.data, { recursive: true });
	appendFileSync(ledgerFile(ctx), `${JSON.stringify(entry)}\n`);
};

const withLedgerLock = <A>(
	ctx: Context,
	f: () => Effect.Effect<A, ShortsError>,
): Effect.Effect<A, ShortsError> =>
	Effect.acquireUseRelease(
		Effect.promise(() => {
			mkdirSync(ctx.paths.data, { recursive: true });
			return acquireLock(join(ctx.paths.data, "ledger.lock"), "ledger");
		}).pipe(
			Effect.flatMap((lock) =>
				"heldBy" in lock
					? Effect.fail(
							fail(
								"conflict",
								"The spend ledger is busy.",
								"Another command is reserving spend; run this one again.",
							),
						)
					: Effect.succeed(lock),
			),
		),
		f,
		(lock) => Effect.sync(() => lock.release()),
	);

export const caps = (ctx: Context) => ({ ...DEFAULT_CAPS, ...ctx.config.caps });

/** Reserves `usd` for one paid call, or fails with `over-budget` when a cap would be passed. */
export const reserve = (
	ctx: Context,
	call: {
		readonly provider: string;
		readonly model: string;
		readonly post: string;
		readonly usd: number;
		readonly note?: string;
	},
): Effect.Effect<string, ShortsError> =>
	withLedgerLock(ctx, () => {
		const entries = readLedger(ctx);
		const day = ctx.now().toISOString().slice(0, 10);
		const { dailyUsd, postUsd } = caps(ctx);
		const today = spent(entries, { day });
		const forPost = spent(entries, { post: call.post });
		if (today + call.usd > dailyUsd) {
			return Effect.fail(
				fail(
					"over-budget",
					`This call (~$${call.usd.toFixed(3)}) would pass today's cap: $${today.toFixed(2)} of $${dailyUsd} spent.`,
					`Wait until tomorrow, or raise caps.dailyUsd in ${join(ctx.paths.data, "config.json")}.`,
				),
			);
		}
		if (forPost + call.usd > postUsd) {
			return Effect.fail(
				fail(
					"over-budget",
					`This call (~$${call.usd.toFixed(3)}) would pass the per-post cap: $${forPost.toFixed(2)} of $${postUsd} spent on ${call.post}.`,
					`Raise caps.postUsd in ${join(ctx.paths.data, "config.json")} if this post is worth more.`,
				),
			);
		}
		const id = randomUUID();
		append(ctx, { id, at: ctx.now().toISOString(), type: "reserve", ...call });
		return Effect.succeed(id);
	});

const close = (
	ctx: Context,
	id: string,
	type: "settle" | "release",
	usd: number,
	requestId?: string,
) =>
	withLedgerLock(ctx, () => {
		const original = readLedger(ctx).find((entry) => entry.id === id && entry.type === "reserve");
		if (original === undefined) return Effect.void;
		append(ctx, {
			...original,
			at: ctx.now().toISOString(),
			type,
			usd,
			...(requestId !== undefined ? { requestId } : {}),
		});
		return Effect.void;
	});

export const settle = (ctx: Context, id: string, usd: number, requestId: string) =>
	close(ctx, id, "settle", usd, requestId);
export const release = (ctx: Context, id: string) => close(ctx, id, "release", 0);
