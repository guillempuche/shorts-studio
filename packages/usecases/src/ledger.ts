/**
 * The spend ledger: `ledger.jsonl` in the data folder. Commands only ever add lines to it.
 *
 * Every paid call reserves its estimated cost before it's sent. All processes share one lock
 * for this, so five posts generating at once can't all pass the daily cap. The reservation is
 * settled when the result arrives, or released if the call failed before anything was billed.
 * These providers don't report the actual charge, so a call settles at what it reserved. Each
 * line keeps its units and the price of one, so totals don't move when a price changes later.
 */

import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fail, type Reason, type ShortsError } from "@shorts-studio/domain/errors";
import { Unit } from "@shorts-studio/domain/models";
import { Effect, Schema } from "effect";
import { type Context, DEFAULT_CAPS } from "./context.ts";
import { withLock } from "./lock.ts";

export const LedgerEntry = Schema.Struct({
	id: Schema.String,
	at: Schema.String,
	type: Schema.Literals(["reserve", "settle", "release"]),
	provider: Schema.String,
	model: Schema.String,
	post: Schema.String,
	usd: Schema.Finite,
	// What the call was billed by, how many, and the price of one. Lines written before prices
	// were data don't have them, and count by `usd` alone.
	unit: Schema.optionalKey(Unit),
	units: Schema.optionalKey(Schema.Finite),
	usdPerUnit: Schema.optionalKey(Schema.Finite),
	requestId: Schema.optionalKey(Schema.String),
	note: Schema.optionalKey(Schema.String),
});
export type LedgerEntry = typeof LedgerEntry.Type;

const ledgerFile = (ctx: Context): string => join(ctx.paths.data, "ledger.jsonl");
const EntryLine = Schema.fromJsonString(LedgerEntry);
const decodeEntry = Schema.decodeUnknownEffect(EntryLine);

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
		if (entry.type === "reserve") {
			byId.set(entry.id, { reserve: entry, usd: entry.usd });
		} else {
			const reservation = byId.get(entry.id);
			if (reservation !== undefined) reservation.usd = entry.type === "release" ? 0 : entry.usd;
		}
	}
	return [...byId.values()];
};

/**
 * Dollars spent on one day (a UTC date, YYYY-MM-DD), on one post, or both. A reservation that
 * isn't settled yet counts in full.
 */
export const spent = (
	entries: ReadonlyArray<LedgerEntry>,
	{ day, post }: { readonly day?: string; readonly post?: string },
): number =>
	amounts(entries)
		.filter(({ reserve }) => day === undefined || reserve.at.startsWith(day))
		.filter(({ reserve }) => post === undefined || reserve.post === post)
		.reduce((sum, { usd }) => sum + usd, 0);

const append = (ctx: Context, entry: LedgerEntry): void => {
	appendFileSync(ledgerFile(ctx), `${Schema.encodeSync(EntryLine)(entry)}\n`);
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

/** One paid call, priced: what `costOf` gives, plus the post it's for. */
export interface PaidCall {
	readonly provider: string;
	readonly model: string;
	readonly post: string;
	readonly unit: Unit;
	readonly units: number;
	readonly usdPerUnit: number;
	readonly usd: number;
	readonly note?: string;
}

/** Reserves `call.usd`, or fails with `over-budget` when a cap would be passed. */
export const reserve = (ctx: Context, call: PaidCall): Effect.Effect<string, ShortsError> =>
	withLedgerLock(
		ctx,
		Effect.gen(function* () {
			const entries = yield* readLedger(ctx);
			const { dailyUsd, postUsd } = caps(ctx);
			const spentToday = spent(entries, { day: ctx.now().toISOString().slice(0, 10) });
			const spentOnPost = spent(entries, { post: call.post });
			const configFile = join(ctx.paths.data, "config.json");

			if (spentToday + call.usd > dailyUsd) {
				return yield* fail(
					"over-budget",
					`This call (~$${call.usd.toFixed(3)}) would pass today's cap: $${spentToday.toFixed(2)} of $${dailyUsd} spent.`,
					`Wait until tomorrow, or raise caps.dailyUsd in ${configFile}.`,
				);
			}
			if (spentOnPost + call.usd > postUsd) {
				return yield* fail(
					"over-budget",
					`This call (~$${call.usd.toFixed(3)}) would pass the per-post cap: $${spentOnPost.toFixed(2)} of $${postUsd} spent on ${call.post}.`,
					`Raise caps.postUsd in ${configFile} if this post is worth more.`,
				);
			}

			const id = randomUUID();
			append(ctx, { id, at: ctx.now().toISOString(), type: "reserve", ...call });
			return id;
		}),
	);

/** Adds a line closing reservation `id`. It repeats the reservation, so each line reads alone. */
const close = (
	ctx: Context,
	id: string,
	change: Pick<LedgerEntry, "type"> & Partial<Pick<LedgerEntry, "usd" | "requestId">>,
) =>
	withLedgerLock(
		ctx,
		Effect.gen(function* () {
			const reserved = (yield* readLedger(ctx)).find(
				(entry) => entry.id === id && entry.type === "reserve",
			);
			if (reserved === undefined) return;
			append(ctx, { ...reserved, at: ctx.now().toISOString(), ...change });
		}),
	);

/**
 * Settles reservation `id` at the amount it reserved, even if the model's price changed since:
 * the provider billed the price of the day the call was sent.
 */
export const settle = (ctx: Context, id: string, requestId?: string) =>
	close(ctx, id, { type: "settle", ...(requestId === undefined ? {} : { requestId }) });

/** Frees reservation `id`, for a call that failed before anything was billed. */
export const release = (ctx: Context, id: string) => close(ctx, id, { type: "release", usd: 0 });

/** Failures that prove a paid call billed nothing. */
const NOTHING_BILLED: ReadonlySet<Reason["_tag"]> = new Set([
	// The provider said no, or reported that the job failed.
	"Refused",
	"RequestEnded",
	// The call stopped before anything was sent.
	"MissingKey",
	"Usage",
	"NotFound",
]);

/**
 * Whether a failed paid call surely cost nothing, so its reservation may be freed. Any other
 * failure, such as a 5xx or a dropped connection, may have been billed: it stays counted.
 */
const nothingBilled = (error: ShortsError): boolean => NOTHING_BILLED.has(error.reason._tag);

/** Frees reservation `id` if `error` proves nothing was billed; otherwise it stays counted. */
export const releaseIfNothingBilled = (ctx: Context, id: string, error: ShortsError) =>
	nothingBilled(error) ? Effect.ignore(release(ctx, id)) : Effect.void;

/**
 * Runs a paid call that answers in one go: reserves its cost first, settles it when the call
 * succeeds, and frees it only when the call failed without billing.
 */
export const paidCall = <A, R>(
	ctx: Context,
	call: PaidCall,
	effect: Effect.Effect<A, ShortsError, R>,
): Effect.Effect<A, ShortsError, R> =>
	Effect.flatMap(reserve(ctx, call), (id) =>
		effect.pipe(
			Effect.tapError((error) => releaseIfNothingBilled(ctx, id, error)),
			// The result is paid for, so keep it even if the ledger can't be closed: an open
			// reservation counts the same amount as a settled one.
			Effect.tap(() => Effect.ignore(settle(ctx, id))),
		),
	);
