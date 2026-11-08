import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DateTime, Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import { startOfToday } from "./days.ts";
import { acquireLock } from "./files.ts";
import { type PaidCall, readLedger, release, reserve, settle, spent } from "./ledger.ts";
import { testContext } from "./test/context.ts";

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
		expect(spent(entries, { since: startOfToday(ctx) })).toBeCloseTo(0.3);
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

describe("readLedger", () => {
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
		expect(spent(entries, { since: startOfToday(ctx) })).toBeCloseTo(0.35);
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
