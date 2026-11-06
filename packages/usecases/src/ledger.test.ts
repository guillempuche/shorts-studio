import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import { acquireLock } from "./files.ts";
import { readLedger, release, reserve, settle, spent } from "./ledger.ts";
import { testContext } from "./testing.ts";

const call = (post: string, usd: number) => ({ provider: "fal", model: "m", post, usd });

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
	it("should free a released reservation and count a settled one at its final amount", async () => {
		// GIVEN two $0.50 reservations
		const ctx = testContext();
		const a = await Effect.runPromise(reserve(ctx, call("p", 0.5)));
		const b = await Effect.runPromise(reserve(ctx, call("p", 0.5)));

		// WHEN one is released and the other settled at $0.30
		await Effect.runPromise(release(ctx, a));
		await Effect.runPromise(settle(ctx, b, 0.3, "req-1"));

		// THEN today's spend is $0.30
		const entries = await Effect.runPromise(readLedger(ctx));
		expect(spent(entries, { day: "2026-11-04" })).toBeCloseTo(0.3);
	});
});

describe("readLedger", () => {
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
