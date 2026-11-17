import { DateTime, Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { Context } from "../context.ts";
import { type PaidCall, reserve } from "../ledger.ts";
import { BROKEN_CONFIG, testContext } from "../test/context.ts";
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
		expect(result.todayUsd).toBe(0.3);
		expect(result.monthUsd).toBe(0.5);
		expect(result.monthlyCapUsd).toBe(100);
		// AND each post's total counts every month, rounded to millionths ($0.10 + $0.20 is $0.30)
		expect(result.posts.map((p) => [p.post, p.usd])).toEqual([
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

	it("should show a sub-cent spend and a sub-cent cap as different amounts", async () => {
		// GIVEN a daily cap of $0.004 and $0.003 spent today
		const ctx = testContext({ config: { caps: { dailyUsd: 0.004 } } });
		await spendAt(ctx, "2026-11-04T08:00:00Z", "a", 0.003);

		// WHEN the budget is shown
		const result = await run(budgetShow.run({ post: undefined }, ctx, MODE));

		// THEN today reads as two different amounts, neither as $0.00
		expect(budgetShow.render?.(result)).toContain("Today (2026-11-04): $0.003 of $0.004");
	});

	it("should list a config.json that can't be used, and say each cap is the default", async () => {
		// GIVEN a config.json that couldn't be used, so the caps are the defaults
		const ctx = testContext({ settingsIssues: [BROKEN_CONFIG] });

		// WHEN the budget is shown
		const result = await run(budgetShow.run({ post: undefined }, ctx, MODE));

		// THEN the result lists the config.json problem
		expect(result.settingsIssues).toEqual([BROKEN_CONFIG]);
		// AND says where each cap comes from: its default
		expect(result.capsFrom).toEqual({
			dailyUsd: "default",
			monthlyUsd: "default",
			postUsd: "default",
		});
		expect(budgetShow.render?.(result)).toContain("$0.00 of $5.00 (the default)");
	});

	it("should say a cap set by a variable comes from that variable", async () => {
		// GIVEN a $1 daily cap set by SHORTS_CAPS_DAILY_USD, and a per-post cap set in config.json
		const ctx = testContext({
			config: { caps: { dailyUsd: 1, postUsd: 0.5 } },
			capsFrom: {
				dailyUsd: "SHORTS_CAPS_DAILY_USD",
				monthlyUsd: "default",
				postUsd: "/data/config.json",
			},
		});

		// WHEN the budget is shown
		const result = await run(budgetShow.run({ post: undefined }, ctx, MODE));
		const text = budgetShow.render?.(result);

		// THEN the daily cap of $1 comes from the variable, and the per-post cap from the file
		expect(result.capsFrom.dailyUsd).toBe("SHORTS_CAPS_DAILY_USD");
		expect(text).toContain("of $1.00 (set by SHORTS_CAPS_DAILY_USD)");
		expect(text).toContain("Per post: $0.50 (set in /data/config.json)");
		// AND there's nothing wrong with the settings
		expect(result.settingsIssues).toEqual([]);
	});

	it("should give today's total in JSON to millionths of a dollar", async () => {
		// GIVEN three reservations of $0.02405 today
		const ctx = testContext();
		for (const at of ["08:00", "09:00", "10:00"]) {
			await spendAt(ctx, `2026-11-04T${at}:00Z`, "a", 0.02405);
		}

		// WHEN the budget is shown
		const result = await run(budgetShow.run({ post: undefined }, ctx, MODE));

		// THEN today's total is exact, without the float sum's noise
		expect(result.todayUsd).toBe(0.07215);
	});
});
