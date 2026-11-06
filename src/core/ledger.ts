/**
 * The spend ledger: `ledger.jsonl` in the data folder. Commands only ever add lines to it.
 *
 * Every paid call reserves its estimated cost before it's sent. All processes share one lock
 * for this, so five posts generating at once can't all pass the daily cap. The reservation is
 * settled when the result arrives, or released if the call failed before anything was billed.
 * These providers don't report the actual charge, so a settled amount is the estimate.
 */

import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Effect, Schema } from "effect";
import { type Context, DEFAULT_CAPS } from "./context.ts";
import { fail, type ShortsError } from "./errors.ts";
import { withLock } from "./lock.ts";

export const LedgerEntry = Schema.Struct({
	id: Schema.String,
	at: Schema.String,
	type: Schema.Literals(["reserve", "settle", "release"]),
	provider: Schema.String,
	model: Schema.String,
	post: Schema.String,
	usd: Schema.Finite,
	requestId: Schema.optionalKey(Schema.String),
	note: Schema.optionalKey(Schema.String),
});
export type LedgerEntry = typeof LedgerEntry.Type;

const ledgerFile = (ctx: Context): string => join(ctx.paths.data, "ledger.jsonl");
const decodeEntry = Schema.decodeUnknownEffect(Schema.fromJsonString(LedgerEntry));

/** Every entry. A corrupt line fails the read, since the caps can't be trusted past it. */
export const readLedger = (
	ctx: Context,
): Effect.Effect<ReadonlyArray<LedgerEntry>, ShortsError> => {
	const file = ledgerFile(ctx);
	if (!existsSync(file)) return Effect.succeed([]);
	const lines = readFileSync(file, "utf8")
		.split("\n")
		.filter((line) => line.trim() !== "");
	return Effect.forEach(lines, (line, i) =>
		decodeEntry(line).pipe(
			Effect.mapError((error) =>
				fail(
					"failed",
					`${file} line ${i + 1} is corrupt:\n${error.message}`,
					"Fix or remove that line; commands only append to this file.",
				),
			),
		),
	);
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
	appendFileSync(ledgerFile(ctx), `${JSON.stringify(entry)}\n`);
};

const withLedgerLock = <A>(ctx: Context, use: Effect.Effect<A, ShortsError>) =>
	Effect.suspend(() => {
		mkdirSync(ctx.paths.data, { recursive: true });
		return withLock(
			join(ctx.paths.data, "ledger.lock"),
			"ledger",
			() =>
				fail(
					"conflict",
					"The spend ledger is busy.",
					"Another command is updating it; run this one again.",
				),
			use,
		);
	});

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
	withLedgerLock(
		ctx,
		Effect.gen(function* () {
			const entries = yield* readLedger(ctx);
			const { dailyUsd, postUsd } = caps(ctx);
			const today = spent(entries, { day: ctx.now().toISOString().slice(0, 10) });
			const forPost = spent(entries, { post: call.post });
			const config = join(ctx.paths.data, "config.json");
			if (today + call.usd > dailyUsd) {
				return yield* fail(
					"over-budget",
					`This call (~$${call.usd.toFixed(3)}) would pass today's cap: $${today.toFixed(2)} of $${dailyUsd} spent.`,
					`Wait until tomorrow, or raise caps.dailyUsd in ${config}.`,
				);
			}
			if (forPost + call.usd > postUsd) {
				return yield* fail(
					"over-budget",
					`This call (~$${call.usd.toFixed(3)}) would pass the per-post cap: $${forPost.toFixed(2)} of $${postUsd} spent on ${call.post}.`,
					`Raise caps.postUsd in ${config} if this post is worth more.`,
				);
			}
			const id = randomUUID();
			append(ctx, { id, at: ctx.now().toISOString(), type: "reserve", ...call });
			return id;
		}),
	);

const close = (
	ctx: Context,
	id: string,
	type: "settle" | "release",
	usd: number,
	requestId?: string,
) =>
	withLedgerLock(
		ctx,
		Effect.gen(function* () {
			const original = (yield* readLedger(ctx)).find(
				(entry) => entry.id === id && entry.type === "reserve",
			);
			if (original === undefined) return;
			append(ctx, {
				...original,
				at: ctx.now().toISOString(),
				type,
				usd,
				...(requestId !== undefined ? { requestId } : {}),
			});
		}),
	);

export const settle = (ctx: Context, id: string, usd: number, requestId: string) =>
	close(ctx, id, "settle", usd, requestId);
export const release = (ctx: Context, id: string) => close(ctx, id, "release", 0);
