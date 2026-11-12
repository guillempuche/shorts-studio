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
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fail, type Reason, type ShortsError } from "@shorts-studio/domain/errors";
import { Unit } from "@shorts-studio/domain/models";
import { Effect, Schema } from "effect";
import { type Context, DEFAULT_CAPS } from "./context.ts";
import { daysNow } from "./days.ts";
import { appendText, ensureDir, readText } from "./files.ts";
import { withLock } from "./lock.ts";

/**
 * An instant written exactly as `toISOString` writes it (2026-11-04T09:00:00.000Z). `spent`
 * compares these as strings, which only works in this one form, so a hand-edited line written
 * any other way is refused as corrupt instead of counted on the wrong day.
 */
const Instant = Schema.String.check(
	Schema.makeFilter((at) =>
		/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(at) && !Number.isNaN(Date.parse(at))
			? undefined
			: "an instant written like 2026-11-04T09:00:00.000Z",
	),
);

const Amount = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0));

export const LedgerEntry = Schema.Struct({
	id: Schema.String,
	at: Instant,
	type: Schema.Literals(["reserve", "settle", "release"]),
	provider: Schema.String,
	model: Schema.String,
	post: Schema.String,
	usd: Amount,
	// What the call was billed by, how many, and the price of one. Lines written before prices
	// were data don't have them, and count by `usd` alone.
	unit: Schema.optionalKey(Unit),
	units: Schema.optionalKey(Amount),
	usdPerUnit: Schema.optionalKey(Amount),
	requestId: Schema.optionalKey(Schema.String),
	note: Schema.optionalKey(Schema.String),
});
export type LedgerEntry = typeof LedgerEntry.Type;

const ledgerFile = (ctx: Context): string => join(ctx.paths.data, "ledger.jsonl");
const EntryLine = Schema.fromJsonString(LedgerEntry);
const decodeEntry = Schema.decodeUnknownEffect(EntryLine);

/** The ledger as read: its entries, and whether a hand edit left its last line unended. */
interface LedgerFile {
	readonly entries: ReadonlyArray<LedgerEntry>;
	readonly endsMidLine: boolean;
}

/** A corrupt line fails the read, since the caps can't be trusted past it. */
const readLedgerFile = (ctx: Context): Effect.Effect<LedgerFile, ShortsError> => {
	const file = ledgerFile(ctx);
	// Read when the Effect runs, not when it's built: a caller may build it before taking the lock.
	return Effect.suspend(() =>
		existsSync(file)
			? readText(file, "The ledger was removed while it was being read; run the command again.")
			: Effect.succeed(""),
	).pipe(Effect.flatMap((text) => parseLedger(file, text)));
};

const parseLedger = (file: string, text: string): Effect.Effect<LedgerFile, ShortsError> => {
	// Some editors save a byte-order mark first; it isn't part of the first line's JSON.
	// Numbered before blank lines are dropped, so an error names the line an editor shows.
	const lines = text
		.replace(/^\uFEFF/, "")
		.split("\n")
		.map((line, i) => ({ line, number: i + 1 }))
		.filter(({ line }) => line.trim() !== "");
	return Effect.forEach(lines, ({ line, number }) =>
		decodeEntry(line).pipe(
			Effect.mapError((error) =>
				fail(
					"failed",
					`${file} line ${number} is corrupt:\n${error.message}`,
					"Fix or remove that line; commands only append to this file.",
				),
			),
		),
	).pipe(Effect.map((entries) => ({ entries, endsMidLine: text !== "" && !text.endsWith("\n") })));
};

/** Every entry. A corrupt line fails the read, since the caps can't be trusted past it. */
export const readLedger = (ctx: Context): Effect.Effect<ReadonlyArray<LedgerEntry>, ShortsError> =>
	Effect.map(readLedgerFile(ctx), ({ entries }) => entries);

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
 * Dollars spent on one post, since an instant (the start of a local day or month, from
 * `days.ts`), or both. A reservation counts from when it was made; one not settled yet counts in
 * full. A line dated after now, from a clock set ahead, counts too: that errs toward spending less.
 */
export const spent = (entries: ReadonlyArray<LedgerEntry>, filter: SpendFilter): number =>
	total(amounts(entries), filter);

interface SpendFilter {
	readonly post?: string;
	readonly since?: string;
}

const total = (live: ReturnType<typeof amounts>, { post, since }: SpendFilter): number =>
	live
		.filter(({ reserve }) => post === undefined || reserve.post === post)
		.filter(({ reserve }) => since === undefined || reserve.at >= since)
		.reduce((sum, { usd }) => sum + usd, 0);

/** Adds `entry` as a line, ending the last one first if a hand edit left it unended. */
const append = (ctx: Context, ledger: LedgerFile, entry: LedgerEntry) => {
	// Without it, the new line would join the last one, and the ledger would read as corrupt.
	const lead = ledger.endsMidLine ? "\n" : "";
	return appendText(ledgerFile(ctx), `${lead}${Schema.encodeSync(EntryLine)(entry)}\n`);
};

const withLedgerLock = <A>(ctx: Context, use: Effect.Effect<A, ShortsError>) =>
	Effect.andThen(
		ensureDir(ctx.paths.data),
		withLock(
			join(ctx.paths.data, "ledger.lock"),
			"ledger",
			() =>
				fail(
					"conflict",
					"The spend ledger is busy.",
					"Another command is updating it; run this one again.",
				),
			use,
		),
	);

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

/**
 * Whether adding `usd` to `spentUsd` passes `capUsd`. Compared in millionths of a dollar, so
 * float noise ($0.10 + $0.20 is 0.30000000000000004) can't refuse a total that lands on the cap.
 */
const passes = (spentUsd: number, usd: number, capUsd: number): boolean =>
	Math.round((spentUsd + usd) * 1e6) > Math.round(capUsd * 1e6);

/**
 * What to do about a cap: waiting helps for a day or a month, never for a post, nor at $0.
 * Raising one is left to the user, since an agent reads this fix as its next step.
 */
const capFix = (setting: string, capUsd: number, wait: string | undefined, configFile: string) => {
	const raise = `Raising ${setting} in ${configFile} is the user's decision.`;
	if (capUsd === 0) return `${setting} is 0, so nothing can be spent. ${raise}`;
	return wait === undefined ? raise : `${wait}. ${raise}`;
};

/**
 * What a call would leave under each cap, and whether it fits. A dry run reports it, so an agent
 * learns a call won't fit before the real run fails. `stoppedBy` names what stops it.
 */
export const Budget = Schema.Struct({
	fits: Schema.Boolean,
	leftTodayUsd: Schema.Finite,
	leftThisMonthUsd: Schema.Finite,
	leftOnPostUsd: Schema.Finite,
	stoppedBy: Schema.optionalKey(
		Schema.Literals(["settings", "caps.postUsd", "caps.monthlyUsd", "caps.dailyUsd"]),
	),
	why: Schema.optionalKey(Schema.String),
});
export type Budget = typeof Budget.Type;

/** A dry run's sentence about the caps, for text output. */
export const budgetLine = (budget: Budget): string =>
	budget.fits
		? `It fits the caps: $${budget.leftTodayUsd.toFixed(2)} left today, $${budget.leftOnPostUsd.toFixed(2)} on this post.`
		: `It wouldn't fit: ${budget.why ?? budget.stoppedBy}`;

/** What's left of a cap in dollars, never below 0, rounded to millionths like `passes`. */
const left = (capUsd: number, spentUsd: number): number =>
	Math.max(0, Math.round((capUsd - spentUsd) * 1e6) / 1e6);

/**
 * Why nothing may be spent while a setting can't be used, or undefined when every setting can be:
 * the caps may then be the defaults rather than the user's.
 */
export const settingsRefusal = (ctx: Context): ShortsError | undefined => {
	const [issue, ...more] = ctx.settingsIssues;
	if (issue === undefined) return undefined;
	const others = more.length === 0 ? "" : ` (and ${more.length} more)`;
	return fail(
		"failed",
		`A setting can't be used, so the caps may be the defaults rather than yours, and nothing was spent: ${issue}${others}`,
		// An MCP server reads the settings once, when it starts.
		"Run doctor and fix the settings it names, then run this again. A running MCP server keeps the settings it started with, so restart it after the fix.",
	);
};

/**
 * Checks a call against the caps: the dry run's answer and, under the lock, the reservation's.
 * Settings that couldn't be used come first, since the caps may then be the defaults rather than
 * the user's. Then the cap that waiting would fix last: the post's, the month's, the day's.
 */
const checkCaps = (
	ctx: Context,
	entries: ReadonlyArray<LedgerEntry>,
	call: Pick<PaidCall, "post" | "usd">,
	days: ReturnType<typeof daysNow>,
	plannedUsd = 0,
): { readonly budget: Budget; readonly failure?: ShortsError } => {
	const live = amounts(entries);
	const { dailyUsd, monthlyUsd, postUsd } = caps(ctx);
	// A batch dry run counts what it planned for earlier posts toward the day and the month.
	const spentToday = total(live, { since: days.startOfToday }) + plannedUsd;
	const spentThisMonth = total(live, { since: days.startOfMonth }) + plannedUsd;
	const spentOnPost = total(live, { post: call.post });
	const room = {
		leftTodayUsd: left(dailyUsd, spentToday),
		leftThisMonthUsd: left(monthlyUsd, spentThisMonth),
		leftOnPostUsd: left(postUsd, spentOnPost),
	};
	const stop = (stoppedBy: NonNullable<Budget["stoppedBy"]>, failure: ShortsError) => ({
		budget: { fits: false, ...room, stoppedBy, why: failure.message },
		failure,
	});
	const configFile = join(ctx.paths.data, "config.json");
	const cost = `This call (~$${call.usd.toFixed(3)})`;

	// Nothing to spend fits, whatever the settings or the caps say.
	if (call.usd <= 0) return { budget: { fits: true, ...room } };
	const refusal = settingsRefusal(ctx);
	if (refusal !== undefined) return stop("settings", refusal);
	if (passes(spentOnPost, call.usd, postUsd)) {
		return stop(
			"caps.postUsd",
			fail(
				"over-budget",
				`${cost} would pass the per-post cap: $${spentOnPost.toFixed(2)} of $${postUsd.toFixed(2)} spent on ${call.post}.`,
				capFix("caps.postUsd", postUsd, undefined, configFile),
			),
		);
	}
	if (passes(spentThisMonth, call.usd, monthlyUsd)) {
		return stop(
			"caps.monthlyUsd",
			fail(
				"over-budget",
				`${cost} would pass this month's cap: $${spentThisMonth.toFixed(2)} of $${monthlyUsd.toFixed(2)} spent in ${days.month}.`,
				capFix("caps.monthlyUsd", monthlyUsd, "Wait until next month", configFile),
			),
		);
	}
	if (passes(spentToday, call.usd, dailyUsd)) {
		return stop(
			"caps.dailyUsd",
			fail(
				"over-budget",
				`${cost} would pass today's cap: $${spentToday.toFixed(2)} of $${dailyUsd.toFixed(2)} spent.`,
				capFix("caps.dailyUsd", dailyUsd, "Wait until tomorrow", configFile),
			),
		);
	}
	return { budget: { fits: true, ...room } };
};

/**
 * Whether a call of `usd` for `post` would fit the caps now, for a dry run, after `plannedUsd`
 * that a batch dry run planned for earlier posts. Read without the lock, so another command may
 * spend before the real run, which checks again under it.
 */
export const budgetFor = (
	ctx: Context,
	call: Pick<PaidCall, "post" | "usd">,
	plannedUsd = 0,
): Effect.Effect<Budget, ShortsError> =>
	Effect.map(
		readLedgerFile(ctx),
		({ entries }) => checkCaps(ctx, entries, call, daysNow(ctx), plannedUsd).budget,
	);

/**
 * Reserves `call.usd`, or fails before reserving: with `failed` while a setting can't be used,
 * or with `over-budget` when a cap would be passed (see `checkCaps` for which one it names).
 */
export const reserve = (ctx: Context, call: PaidCall): Effect.Effect<string, ShortsError> =>
	withLedgerLock(
		ctx,
		Effect.gen(function* () {
			// A negative cost would lower the totals and let later calls through.
			if (!Number.isFinite(call.usd) || call.usd < 0) {
				return yield* fail(
					"failed",
					`This call was priced at $${call.usd}, which can't be right, so nothing was reserved.`,
					"Check what it's priced from, such as the audio's length (post show), then run it again.",
				);
			}

			const ledger = yield* readLedgerFile(ctx);
			// One clock reading for the day the call counts toward and the time it's written with.
			const days = daysNow(ctx);
			const { failure } = checkCaps(ctx, ledger.entries, call, days);
			if (failure !== undefined) return yield* failure;

			const id = randomUUID();
			yield* append(ctx, ledger, { id, at: days.at, type: "reserve", ...call });
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
			const ledger = yield* readLedgerFile(ctx);
			const reserved = ledger.entries.find((entry) => entry.id === id && entry.type === "reserve");
			if (reserved === undefined) return;
			yield* append(ctx, ledger, { ...reserved, at: ctx.now().toISOString(), ...change });
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
