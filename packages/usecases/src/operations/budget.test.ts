import { DateTime, Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { Context } from "../context.ts";
import { type PaidCall, reserve } from "../ledger.ts";
import { testContext } from "../test/context.ts";
import { run } from "../test/fakes.ts";
import { budgetShow } from "./budget.ts";

const MODE = { dryRun: false, confirmed: true } as const;

/** A call of `usd` for `post`, billed as one image. */
const call = (post: string, usd: number): PaidCall => ({
	provider: "fake-images",
	model: "fake-fast",
	post,
	unit: "image",
	units: 1,
	usdPerUnit: usd,
	usd,
});

/** Reserves `usd` for `post` as if the call was made at `at`. */
const spendAt = (ctx: Context, at: string, post: string, usd: number) =>
	Effect.runPromise(reserve({ ...ctx, now: () => new Date(at) }, call(post, usd)));

/** A clock that reads each instant once, in turn, then keeps the last. */
const ticking = (...instants: ReadonlyArray<string>) => {
	let reads = 0;
	return () => new Date(instants[Math.min(reads++, instants.length - 1)] ?? "");
};

describe("budget show", () => {
	it("should report $0 today and this month, and no posts, before anything was spent", async () => {
		// GIVEN no ledger yet
		const ctx = testContext();

		// WHEN the budget is shown
		const result = await run(budgetShow.run({ post: undefined }, ctx, MODE));

		// THEN nothing is spent
		expect(result).toMatchObject({ todayUsd: 0, monthUsd: 0, posts: [] });
	});

	it("should take the day and its total from one reading of the clock", async () => {
		// GIVEN $1 spent on 4 November, and a clock that passes midnight while the command runs
		const ctx = testContext();
		await spendAt(ctx, "2026-11-04T12:00:00Z", "a", 1);
		const clock = { ...ctx, now: ticking("2026-11-04T23:59:59.999Z", "2026-11-05T00:00:00.000Z") };

		// WHEN the budget is shown
		const result = await run(budgetShow.run({ post: undefined }, clock, MODE));

		// THEN the day and its total agree: 4 November, with its $1
		expect(result).toMatchObject({ day: "2026-11-04", todayUsd: 1 });
	});

	it("should report today's, this month's and each post's spending against the caps", async () => {
		// GIVEN $0.10 spent last month, $0.20 earlier this month and $0.30 today, on two posts
		const ctx = testContext();
		await spendAt(ctx, "2026-10-30T12:00:00Z", "a", 0.1);
		await spendAt(ctx, "2026-11-02T12:00:00Z", "a", 0.2);
		await spendAt(ctx, "2026-11-04T08:00:00Z", "b", 0.3);

		// WHEN the budget is shown on 2026-11-04
		const result = await run(budgetShow.run({ post: undefined }, ctx, MODE));

		// THEN today counts $0.30 and this month $0.50, each against its cap
		expect(result).toMatchObject({ day: "2026-11-04", dailyCapUsd: 5, month: "2026-11" });
		expect(result.todayUsd).toBeCloseTo(0.3);
		expect(result.monthUsd).toBeCloseTo(0.5);
		expect(result.monthlyCapUsd).toBe(100);
		// AND each post's total counts every month
		expect(result.posts.map((p) => [p.post, Number(p.usd.toFixed(2))])).toEqual([
			["a", 0.3],
			["b", 0.3],
		]);
	});

	it("should start today and this month in the machine's time zone", async () => {
		// GIVEN a machine in Madrid at 00:30 on 1 December, while UTC is still on 30 November,
		// and $0.40 spent an hour earlier, on 30 November in Madrid
		const ctx = testContext({
			timeZone: DateTime.zoneMakeNamedUnsafe("Europe/Madrid"),
			now: () => new Date("2026-11-30T23:30:00Z"),
		});
		await spendAt(ctx, "2026-11-30T22:30:00Z", "a", 0.4);

		// WHEN the budget is shown
		const result = await run(budgetShow.run({ post: undefined }, ctx, MODE));

		// THEN it is already 1 December and a new month there, with nothing spent yet
		expect(result).toMatchObject({ day: "2026-12-01", month: "2026-12", todayUsd: 0, monthUsd: 0 });
	});
});
