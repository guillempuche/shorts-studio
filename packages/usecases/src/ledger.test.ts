import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DateTime, Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import { daysNow } from "./days.ts";
import { acquireLock } from "./files.ts";
import { type PaidCall, readLedger, release, reserve, settle, spent } from "./ledger.ts";
import { testContext } from "./test/context.ts";

/** A ledger line as commands write it, at `at`, for `usd`. */
const line = (at: string, usd: number, extra: Record<string, unknown> = {}) =>
	JSON.stringify({
		id: at,
		at,
		type: "reserve",
		provider: "fal",
		model: "m",
		post: "p",
		usd,
		...extra,
	});

/** Writes the ledger file as given, as a hand edit might leave it. */
const writeLedger = (ctx: ReturnType<typeof testContext>, text: string) => {
	mkdirSync(ctx.paths.data, { recursive: true });
	writeFileSync(join(ctx.paths.data, "ledger.jsonl"), text);
};

/** One call of `usd`, billed as one image. */
const call = (post: string, usd: number): PaidCall => ({
	provider: "fal",
	model: "m",
	post,
	unit: "image",
	units: 1,
	usdPerUnit: usd,
	usd,
});

describe("reserve", () => {
	it("should refuse a call that would pass the daily cap", async () => {
		// GIVEN a $1 daily cap with $0.90 already reserved today
		const ctx = testContext({ config: { caps: { dailyUsd: 1, postUsd: 10 } } });
		await Effect.runPromise(reserve(ctx, call("a", 0.9)));

		// WHEN a $0.20 call is reserved, for another post
		const error = await Effect.runPromise(Effect.flip(reserve(ctx, call("b", 0.2))));

		// THEN it fails as over budget
		expect(error.code).toBe("over-budget");
		// AND says where the cap lives
		expect(error.fix).toContain("config.json");
	});

	it("should refuse a call that would pass the post's cap", async () => {
		// GIVEN a $1 per-post cap with $0.90 reserved for one post
		const ctx = testContext({ config: { caps: { dailyUsd: 10, postUsd: 1 } } });
		await Effect.runPromise(reserve(ctx, call("a", 0.9)));

		// WHEN another $0.20 is reserved for that post
		const error = await Effect.runPromise(Effect.flip(reserve(ctx, call("a", 0.2))));

		// THEN it fails as over budget, naming the post's cap
		expect(error.code).toBe("over-budget");
		expect(error.message).toContain("per-post cap");
	});

	it("should count a call at 00:30 toward the new local day, while UTC is still on the last", async () => {
		// GIVEN a machine in Madrid, a $1 daily cap, and $0.90 spent at 23:00 there on 4 November
		const madrid = testContext({
			timeZone: DateTime.zoneMakeNamedUnsafe("Europe/Madrid"),
			config: { caps: { dailyUsd: 1, postUsd: 10 } },
		});
		const at = (iso: string) => ({ ...madrid, now: () => new Date(iso) });
		await Effect.runPromise(reserve(at("2026-11-04T22:00:00Z"), call("a", 0.9)));

		// WHEN $0.20 is reserved at 00:30 on 5 November there (23:30 UTC on 4 November)
		const result = await Effect.runPromiseExit(reserve(at("2026-11-04T23:30:00Z"), call("a", 0.2)));

		// THEN it counts toward the new day, so it fits the cap
		expect(Exit.isSuccess(result)).toBe(true);
	});

	it("should refuse a call that would pass this month's cap, naming caps.monthlyUsd", async () => {
		// GIVEN a $1 monthly cap with $0.60 spent on 3 November
		const ctx = testContext({ config: { caps: { dailyUsd: 10, monthlyUsd: 1, postUsd: 10 } } });
		await Effect.runPromise(
			reserve({ ...ctx, now: () => new Date("2026-11-03T12:00:00Z") }, call("a", 0.6)),
		);

		// WHEN another $0.60 is reserved on 4 November
		const error = await Effect.runPromise(Effect.flip(reserve(ctx, call("b", 0.6))));

		// THEN it fails as over budget, naming the monthly cap and where to change it
		expect(error.code).toBe("over-budget");
		expect(error.message).toContain("this month's cap");
		expect(error.fix).toContain("caps.monthlyUsd");
	});

	it("should start each month's cap afresh", async () => {
		// GIVEN a $1 monthly cap with $0.90 spent on 31 October
		const ctx = testContext({ config: { caps: { dailyUsd: 10, monthlyUsd: 1, postUsd: 10 } } });
		await Effect.runPromise(
			reserve({ ...ctx, now: () => new Date("2026-10-31T12:00:00Z") }, call("a", 0.9)),
		);

		// WHEN $0.50 is reserved in November
		const result = await Effect.runPromiseExit(reserve(ctx, call("b", 0.5)));

		// THEN it fits, since October's spending doesn't count toward November
		expect(Exit.isSuccess(result)).toBe(true);
	});

	it("should let the 50th $0.04 image through under a $2 post cap", async () => {
		// GIVEN 49 images at $0.04 reserved for one post, $1.96, whose float sum isn't exact
		const ctx = testContext({ config: { caps: { dailyUsd: 10, postUsd: 2 } } });
		for (let i = 0; i < 49; i++) await Effect.runPromise(reserve(ctx, call("a", 0.04)));

		// WHEN the 50th is reserved, which lands exactly on the cap
		const result = await Effect.runPromiseExit(reserve(ctx, call("a", 0.04)));

		// THEN it goes through
		expect(Exit.isSuccess(result)).toBe(true);
	});

	it("should refuse a call priced below zero, writing nothing", async () => {
		// GIVEN a call priced at −$5, as a hand-edited negative audio length would make it
		const ctx = testContext();

		// WHEN it is reserved
		const error = await Effect.runPromise(Effect.flip(reserve(ctx, call("a", -5))));

		// THEN it is refused, and the ledger is untouched, so it can't lower later totals
		expect(error.code).toBe("failed");
		expect(error.message).toContain("$-5");
		expect(await Effect.runPromise(readLedger(ctx))).toHaveLength(0);
	});

	it("should name the post's cap when every cap would be passed, since waiting won't fix it", async () => {
		// GIVEN daily, monthly and per-post caps that a $2 call would all pass
		const ctx = testContext({ config: { caps: { dailyUsd: 1, monthlyUsd: 0.5, postUsd: 0.4 } } });

		// WHEN it is reserved
		const error = await Effect.runPromise(Effect.flip(reserve(ctx, call("a", 2))));

		// THEN the per-post cap is named, with no advice to wait
		expect(error.message).toContain("per-post cap");
		expect(error.fix).toContain("caps.postUsd");
		expect(error.fix).not.toContain("Wait");
	});

	it("should say nothing can be spent when a cap is 0, rather than to wait", async () => {
		// GIVEN a daily cap of $0
		const ctx = testContext({ config: { caps: { dailyUsd: 0 } } });

		// WHEN a $0.01 call is reserved
		const error = await Effect.runPromise(Effect.flip(reserve(ctx, call("a", 0.01))));

		// THEN it is over budget, and the fix says the cap is 0
		expect(error.code).toBe("over-budget");
		expect(error.fix).toContain("caps.dailyUsd is 0, so nothing can be spent");
	});

	it("should let only one of two calls at the same time through when the cap fits one", async () => {
		// GIVEN a $1 cap
		const ctx = testContext({ config: { caps: { dailyUsd: 1, postUsd: 10 } } });

		// WHEN two $0.60 calls reserve at the same time
		const results = await Promise.all([
			Effect.runPromiseExit(reserve(ctx, call("a", 0.6))),
			Effect.runPromiseExit(reserve(ctx, call("a", 0.6))),
		]);

		// THEN exactly one gets through
		expect(results.filter(Exit.isSuccess)).toHaveLength(1);
	});

	it("should wait while another command holds the ledger, then reserve", async () => {
		// GIVEN another command holding the ledger's lock, shared by every process
		const ctx = testContext();
		mkdirSync(ctx.paths.data, { recursive: true });
		const held = await acquireLock(join(ctx.paths.data, "ledger.lock"), "other command");

		// WHEN a call is reserved, and the other command lets go 300 ms later
		const reserving = Effect.runPromise(reserve(ctx, call("a", 0.1)));
		await new Promise((resolve) => setTimeout(resolve, 300));
		const whileHeld = await Effect.runPromise(readLedger(ctx));
		if ("release" in held) held.release();
		await reserving;

		// THEN nothing was written while the lock was held
		expect(whileHeld).toHaveLength(0);
		// AND the reservation went through once it was free
		expect(await Effect.runPromise(readLedger(ctx))).toHaveLength(1);
	});
});

describe("settle and release", () => {
	it("should free a released reservation and count a settled one at what it reserved", async () => {
		// GIVEN a $0.50 reservation and one of 4 megapixels at $0.075 each ($0.30)
		const ctx = testContext();
		const first = await Effect.runPromise(reserve(ctx, call("p", 0.5)));
		const second = await Effect.runPromise(
			reserve(ctx, {
				...call("p", 0.3),
				unit: "megapixel",
				units: 4,
				usdPerUnit: 0.075,
			}),
		);

		// WHEN the first is released and the second settled
		await Effect.runPromise(release(ctx, first));
		await Effect.runPromise(settle(ctx, second, "req-1"));

		// THEN today's spend is $0.30
		const entries = await Effect.runPromise(readLedger(ctx));
		expect(spent(entries, { since: daysNow(ctx).startOfToday })).toBeCloseTo(0.3);
		// AND the settled line keeps the units and the price of one
		expect(entries.find((entry) => entry.type === "settle")).toMatchObject({
			usd: 0.3,
			unit: "megapixel",
			units: 4,
			usdPerUnit: 0.075,
			requestId: "req-1",
		});
	});
});

describe("spent", () => {
	it("should count a line from local midnight toward the new day, and not one a millisecond before", async () => {
		// GIVEN a machine in Madrid, and two lines either side of its midnight on 3–4 November
		const ctx = testContext({
			timeZone: DateTime.zoneMakeNamedUnsafe("Europe/Madrid"),
			now: () => new Date("2026-11-04T09:00:00Z"),
		});
		writeLedger(
			ctx,
			`${line("2026-11-03T22:59:59.999Z", 0.1)}\n${line("2026-11-03T23:00:00.000Z", 0.2)}\n`,
		);

		// WHEN today's spending is added up
		const entries = await Effect.runPromise(readLedger(ctx));

		// THEN only the line from midnight on counts
		expect(spent(entries, { since: daysNow(ctx).startOfToday })).toBeCloseTo(0.2);
	});
});

describe("readLedger", () => {
	it.each([
		["an offset", "2026-11-03T20:00:00-05:00"],
		["no milliseconds", "2026-11-04T09:00:00Z"],
		["words", "yesterday"],
	])(
		"should refuse a line whose time is written with %s, naming the form to use",
		async (_, at) => {
			// GIVEN a hand-edited line whose time isn't written the way commands write it
			const ctx = testContext();
			writeLedger(ctx, `${line(at, 0.1)}\n`);

			// WHEN the ledger is read
			const error = await Effect.runPromise(Effect.flip(readLedger(ctx)));

			// THEN it fails on that line, saying how a time must look
			expect(error.message).toContain("line 1 is corrupt");
			expect(error.message).toContain("2026-11-04T09:00:00.000Z");
		},
	);

	it("should name the line an editor shows, even below a blank line", async () => {
		// GIVEN a good line, a blank line, then a damaged line: line 3 in an editor
		const ctx = testContext();
		writeLedger(ctx, `${line("2026-11-04T08:00:00.000Z", 0.1)}\n\nnot json\n`);

		// WHEN the ledger is read
		const error = await Effect.runPromise(Effect.flip(readLedger(ctx)));

		// THEN the error names line 3
		expect(error.message).toContain("line 3 is corrupt");
	});

	it("should refuse a line with a negative amount, which would lower the totals", async () => {
		// GIVEN a hand-edited line for −$1
		const ctx = testContext();
		writeLedger(ctx, `${line("2026-11-04T08:00:00.000Z", -1)}\n`);

		// WHEN the ledger is read
		const error = await Effect.runPromise(Effect.flip(readLedger(ctx)));

		// THEN it fails on that line
		expect(error.message).toContain("line 1 is corrupt");
	});

	it("should stay readable after a reservation, when a hand edit dropped the last newline", async () => {
		// GIVEN a ledger whose only line has no newline at the end
		const ctx = testContext();
		writeLedger(ctx, line("2026-11-04T08:00:00.000Z", 0.1));

		// WHEN a call is reserved, then the ledger is read
		await Effect.runPromise(reserve(ctx, call("a", 0.2)));
		const entries = await Effect.runPromise(readLedger(ctx));

		// THEN both lines are there
		expect(entries.map((e) => e.usd)).toEqual([0.1, 0.2]);
	});

	it("should read a ledger an editor saved with a byte-order mark", async () => {
		// GIVEN a ledger that starts with a byte-order mark
		const ctx = testContext();
		writeLedger(ctx, `\uFEFF${line("2026-11-04T08:00:00.000Z", 0.1)}\n`);

		// WHEN it is read
		const entries = await Effect.runPromise(readLedger(ctx));

		// THEN its line reads as usual
		expect(entries.map((e) => e.usd)).toEqual([0.1]);
	});

	it("should count a line written before lines had units, by its amount", async () => {
		// GIVEN a ledger with a $0.25 reservation from before lines recorded units
		const ctx = testContext();
		mkdirSync(ctx.paths.data, { recursive: true });
		appendFileSync(
			join(ctx.paths.data, "ledger.jsonl"),
			`${JSON.stringify({ id: "old", at: "2026-11-04T08:00:00.000Z", type: "reserve", provider: "fal", model: "flux-dev", post: "p", usd: 0.25 })}\n`,
		);

		// WHEN a new call is reserved next to it, and the ledger is read
		await Effect.runPromise(reserve(ctx, call("p", 0.1)));
		const entries = await Effect.runPromise(readLedger(ctx));

		// THEN both count toward the day
		expect(spent(entries, { since: daysNow(ctx).startOfToday })).toBeCloseTo(0.35);
	});

	it("should refuse a ledger with a corrupt line, naming the line", async () => {
		// GIVEN a ledger whose second line was damaged
		const ctx = testContext();
		await Effect.runPromise(reserve(ctx, call("p", 0.1)));
		writeFileSync(join(ctx.paths.data, "ledger.jsonl"), "not json\n", { flag: "a" });

		// WHEN it is read
		const error = await Effect.runPromise(Effect.flip(readLedger(ctx)));

		// THEN the read fails, since the caps can't be trusted past that line
		expect(error.code).toBe("failed");
		expect(error.message).toContain("line 2 is corrupt");
	});
});
