import { appendFileSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fail, failBecause, NotSent } from "@shorts-studio/domain/errors";
import { DateTime, Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import { daysNow } from "./days.ts";
import { takeLock } from "./files.ts";
import {
	budgetFor,
	type PaidCall,
	paidCall,
	readLedger,
	release,
	reserve,
	settle,
	spent,
} from "./ledger.ts";
import { BROKEN_CONFIG, testContext } from "./test/context.ts";
import { failurePastLockWait } from "./test/lock.ts";

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

	it("should tell a sub-cent spend apart from its cap, and price the call to its last cent", async () => {
		// GIVEN a $0.004 daily cap with $0.003 already reserved today
		const ctx = testContext({ config: { caps: { dailyUsd: 0.004 } } });
		await Effect.runPromise(reserve(ctx, call("a", 0.003)));

		// WHEN a $0.0015 call is reserved
		const error = await Effect.runPromise(Effect.flip(reserve(ctx, call("a", 0.0015))));

		// THEN the message shows the call, what's spent and the cap as three different amounts
		expect(error.message).toBe(
			"This call (~$0.0015) would pass today's cap: $0.003 of $0.004 spent.",
		);
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
		expect(error.message).toContain("-$5.00");
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
		// AND raising it is left to the user, not given as the next step
		expect(error.fix).toContain("is the user's decision");
		expect(error.fix).not.toMatch(/^Raise/);
	});

	it("should name the variable that set a cap, and not config.json", async () => {
		// GIVEN a $1 daily cap set by SHORTS_CAPS_DAILY_USD
		const ctx = testContext({
			config: { caps: { dailyUsd: 1, postUsd: 10 } },
			capsFrom: { dailyUsd: "SHORTS_CAPS_DAILY_USD", monthlyUsd: "default", postUsd: "default" },
		});

		// WHEN a $2 call is reserved
		const error = await Effect.runPromise(Effect.flip(reserve(ctx, call("a", 2))));

		// THEN the fix names the variable as where the cap was set
		expect(error.code).toBe("over-budget");
		expect(error.fix).toContain("caps.dailyUsd (set by SHORTS_CAPS_DAILY_USD)");
		expect(error.fix).not.toContain("config.json");
	});

	it("should name config.json as where a cap was set, or would be set when it's the default", async () => {
		// GIVEN a $1 per-post cap set in config.json, and the default $5 daily cap
		const ctx = testContext({ config: { caps: { postUsd: 1 } } });
		const configFile = join(ctx.paths.data, "config.json");

		// WHEN a $1.50 call, then a $6 call on another post, are reserved
		const post = await Effect.runPromise(Effect.flip(reserve(ctx, call("a", 1.5))));
		const day = await Effect.runPromise(
			Effect.flip(reserve({ ...ctx, config: { caps: { postUsd: 10 } } }, call("b", 6))),
		);

		// THEN each fix says where its cap was set
		expect(post.fix).toContain(`caps.postUsd (set in ${configFile})`);
		expect(day.fix).toContain(`caps.dailyUsd (its default; it's set in ${configFile})`);
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
		const held = await Effect.runPromise(
			takeLock(join(ctx.paths.data, "ledger.lock"), "other command"),
		);

		// WHEN a call is reserved, and the other command lets go 300 ms later
		const reserving = Effect.runPromise(reserve(ctx, call("a", 0.1)));
		await new Promise((resolve) => setTimeout(resolve, 300));
		const whileHeld = await Effect.runPromise(readLedger(ctx));
		held.release();
		await reserving;

		// THEN nothing was written while the lock was held
		expect(whileHeld).toHaveLength(0);
		// AND the reservation went through once it was free
		expect(await Effect.runPromise(readLedger(ctx))).toHaveLength(1);
	});

	it("should name the process holding a busy ledger, and its lock file", async () => {
		// GIVEN another command holding the ledger's lock
		const ctx = testContext();
		mkdirSync(ctx.paths.data, { recursive: true });
		const lockFile = join(ctx.paths.data, "ledger.lock");
		const held = await Effect.runPromise(takeLock(lockFile, "reserve for b"));

		// WHEN a call is reserved and the lock stays busy past the wait
		const error = await failurePastLockWait(reserve(ctx, call("a", 0.1)));
		held.release();

		// THEN it is a conflict naming the holder's command, its process and the ledger's lock file
		expect(error.code).toBe("conflict");
		expect(error.message).toContain(`"reserve for b" (pid ${process.pid})`);
		expect(error.message).toContain(lockFile);
		// AND the fix says to delete that file if the process isn't shorts-studio
		expect(error.fix).toContain(`delete ${lockFile}, then run this again.`);
		// AND nothing was reserved
		expect(await Effect.runPromise(readLedger(ctx))).toHaveLength(0);
	});

	it("should take the ledger's lock whose process number went to a program started after it", async () => {
		// GIVEN a ledger lock taken ten minutes ago by a process number that a program started a
		// minute ago now has
		const ctx = testContext({ processStartedAt: async () => new Date(Date.now() - 60_000) });
		mkdirSync(ctx.paths.data, { recursive: true });
		writeFileSync(
			join(ctx.paths.data, "ledger.lock"),
			JSON.stringify({
				pid: process.pid,
				command: "reserve for b",
				since: new Date(Date.now() - 10 * 60_000).toISOString(),
			}),
		);

		// WHEN a call is reserved
		await Effect.runPromise(reserve(ctx, call("a", 0.1)));

		// THEN it went through
		expect(await Effect.runPromise(readLedger(ctx))).toHaveLength(1);
	});
});

describe("budgetFor", () => {
	it("should say what's left under each cap and that a call fits", async () => {
		// GIVEN $1 a day, $10 a month and $2 a post, with $0.40 spent on post a today
		const ctx = testContext({ config: { caps: { dailyUsd: 1, monthlyUsd: 10, postUsd: 2 } } });
		await Effect.runPromise(reserve(ctx, call("a", 0.4)));

		// WHEN a $0.20 call for post a is checked
		const budget = await Effect.runPromise(budgetFor(ctx, { post: "a", usd: 0.2 }));

		// THEN it fits, and what's left is each cap minus what's spent
		expect(budget).toEqual({
			fits: true,
			leftTodayUsd: 0.6,
			leftThisMonthUsd: 9.6,
			leftOnPostUsd: 1.6,
		});
	});

	it.each([
		["caps.postUsd", { dailyUsd: 10, monthlyUsd: 10, postUsd: 0.5 }],
		["caps.monthlyUsd", { dailyUsd: 10, monthlyUsd: 0.5, postUsd: 10 }],
		["caps.dailyUsd", { dailyUsd: 0.5, monthlyUsd: 10, postUsd: 10 }],
	])("should name %s as what stops a call, as the reservation would", async (cap, caps) => {
		// GIVEN a $0.50 cap and $0.40 already spent on post a
		const ctx = testContext({ config: { caps } });
		await Effect.runPromise(reserve(ctx, call("a", 0.4)));

		// WHEN a $0.20 call for post a is checked, then reserved
		const budget = await Effect.runPromise(budgetFor(ctx, { post: "a", usd: 0.2 }));
		const error = await Effect.runPromise(Effect.flip(reserve(ctx, call("a", 0.2))));

		// THEN the check says it doesn't fit, naming that cap with the reservation's own message and fix
		expect(budget.fits).toBe(false);
		expect(budget.stoppedBy).toBe(cap);
		expect(budget.why).toBe(error.message);
		expect(budget.fix).toBe(error.fix);
	});
});

describe("budgetFor, with the keys the real run would use", () => {
	const KEY = { env: "FAKE_IMAGES_KEY", keychain: "fake-images" };

	it("should say a call can't go ahead without its key, naming it", async () => {
		// GIVEN a key that isn't set, and caps with room
		const ctx = testContext();

		// WHEN a $0.20 call that would use that key is checked
		const budget = await Effect.runPromise(
			budgetFor(ctx, { post: "a", usd: 0.2 }, { keys: [KEY] }),
		);

		// THEN it can't go ahead, stopped by the missing key, with the key's own fix
		expect(budget).toMatchObject({ fits: false, stoppedBy: "missing-key" });
		expect(budget.why).toContain("FAKE_IMAGES_KEY");
		expect(budget.fix).toContain("Keychain");
	});

	it("should need the key even for a call of $0, since fetching what's paid for uses it", async () => {
		// GIVEN a key that isn't set
		const ctx = testContext();

		// WHEN a $0 call that would fetch with that key is checked
		const budget = await Effect.runPromise(budgetFor(ctx, { post: "a", usd: 0 }, { keys: [KEY] }));

		// THEN it can't go ahead, stopped by the missing key
		expect(budget).toMatchObject({ fits: false, stoppedBy: "missing-key" });
	});

	it("should let a call of $0 go ahead once its key is set", async () => {
		// GIVEN the key set
		const ctx = testContext({ secrets: { FAKE_IMAGES_KEY: "k" } });

		// WHEN a $0 call that would fetch with that key is checked
		const budget = await Effect.runPromise(budgetFor(ctx, { post: "a", usd: 0 }, { keys: [KEY] }));

		// THEN it fits
		expect(budget.fits).toBe(true);
	});

	it("should name a setting that can't be used before a missing key", async () => {
		// GIVEN a config.json that couldn't be used, and a key that isn't set
		const ctx = testContext({ settingsIssues: [BROKEN_CONFIG] });

		// WHEN a $0.20 call that would use that key is checked
		const budget = await Effect.runPromise(
			budgetFor(ctx, { post: "a", usd: 0.2 }, { keys: [KEY] }),
		);

		// THEN the setting stops it
		expect(budget.stoppedBy).toBe("settings");
	});

	it("should name a missing key before a cap", async () => {
		// GIVEN a daily cap the call would pass, and a key that isn't set
		const ctx = testContext({ config: { caps: { dailyUsd: 0.1 } } });

		// WHEN a $0.20 call that would use that key is checked
		const budget = await Effect.runPromise(
			budgetFor(ctx, { post: "a", usd: 0.2 }, { keys: [KEY] }),
		);

		// THEN the missing key stops it
		expect(budget.stoppedBy).toBe("missing-key");
	});

	it("should check the caps once the key is set", async () => {
		// GIVEN a daily cap the call would pass, and the key set
		const ctx = testContext({
			config: { caps: { dailyUsd: 0.1 } },
			secrets: { FAKE_IMAGES_KEY: "k" },
		});

		// WHEN a $0.20 call that would use that key is checked
		const budget = await Effect.runPromise(
			budgetFor(ctx, { post: "a", usd: 0.2 }, { keys: [KEY] }),
		);

		// THEN the daily cap stops it
		expect(budget.stoppedBy).toBe("caps.dailyUsd");
	});
});

describe("settings that can't be used", () => {
	it("should reserve nothing, since the caps may be the defaults rather than the user's", async () => {
		// GIVEN a config.json value that couldn't be used
		const ctx = testContext({ settingsIssues: [BROKEN_CONFIG] });

		// WHEN a call is reserved, and a dry run checks one
		const error = await Effect.runPromise(Effect.flip(reserve(ctx, call("a", 0.01))));
		const budget = await Effect.runPromise(budgetFor(ctx, { post: "a", usd: 0.01 }));

		// THEN the call fails before anything is written, naming the setting
		expect(error.code).toBe("failed");
		expect(error.message).toContain(
			'/data/config.json: captions.fontSize: Expected a number, got "big"',
		);
		expect(error.message).toContain("the caps may be the defaults");
		expect(await Effect.runPromise(readLedger(ctx))).toEqual([]);
		// AND the fix names doctor in both forms, and the MCP server's restart
		expect(error.fix).toContain("doctor (`config_check` over MCP)");
		expect(error.fix).toContain("restart it after the fix");
		// AND the first step is the agent's config_check, then the user's fix
		expect(error.nextSteps.map((step) => [step.by, step.tool])).toEqual([
			["agent", "config_check"],
			["user", undefined],
		]);
		// AND the dry run says it doesn't fit, for the same reason
		expect(budget).toMatchObject({ fits: false, stoppedBy: "settings" });
	});

	it("should name a misspelt cap and the cap it meant, and say the caps may be the defaults", async () => {
		// GIVEN config.json setting caps.daily, which names no setting
		const ctx = testContext({
			settingsIssues: [
				{
					source: "/data/config.json",
					risk: "caps",
					text: "caps.daily isn't a setting; the closest is caps.dailyUsd.",
					setting: "caps.dailyUsd",
				},
			],
		});

		// WHEN a call is reserved
		const error = await Effect.runPromise(Effect.flip(reserve(ctx, call("a", 0.01))));

		// THEN nothing is reserved, and the message names both and the caps at risk
		expect(error.code).toBe("failed");
		expect(error.message).toContain("caps.daily isn't a setting");
		expect(error.message).toContain("caps.dailyUsd");
		expect(error.message).toContain("the caps may be the defaults");
		expect(await Effect.runPromise(readLedger(ctx))).toEqual([]);
	});

	it("should say a broken brand.json would make images without the brand's style, not name the caps", async () => {
		// GIVEN a brand.json that isn't valid
		const ctx = testContext({
			settingsIssues: [
				{
					source: "/data/brand.json",
					risk: "brand",
					text: "imagePrompt.suffix: Expected string, got 3",
				},
			],
		});

		// WHEN a call is reserved
		const error = await Effect.runPromise(Effect.flip(reserve(ctx, call("a", 0.01))));

		// THEN nothing is reserved, and the message says what's at risk
		expect(error.code).toBe("failed");
		expect(error.message).toContain("images would be made without your brand's style");
		expect(error.message).not.toContain("caps");
		expect(await Effect.runPromise(readLedger(ctx))).toEqual([]);
	});

	it("should lead with the problem that puts the caps at risk, whatever its place", async () => {
		// GIVEN a variable that isn't valid, then a config.json that couldn't be used
		const ctx = testContext({
			settingsIssues: [
				{
					source: "SHORTS_CAPTIONS_FONT_SIZE",
					risk: "setting",
					text: 'Expected a number, got "big"',
					setting: "captions.fontSize",
				},
				BROKEN_CONFIG,
			],
		});

		// WHEN a call is reserved
		const error = await Effect.runPromise(Effect.flip(reserve(ctx, call("a", 0.01))));

		// THEN the message is about the caps, and counts the other problem
		expect(error.message).toContain("the caps may be the defaults");
		expect(error.message).toContain("/data/config.json");
		expect(error.message).toContain("(and 1 more)");
	});

	it("should name the one setting at its default when that's all that's at risk", async () => {
		// GIVEN only a caption size variable that isn't valid
		const ctx = testContext({
			settingsIssues: [
				{
					source: "SHORTS_CAPTIONS_FONT_SIZE",
					risk: "setting",
					text: 'Expected a number, got "big"',
					setting: "captions.fontSize",
				},
			],
		});

		// WHEN a call is reserved
		const error = await Effect.runPromise(Effect.flip(reserve(ctx, call("a", 0.01))));

		// THEN the message names that setting, not the caps
		expect(error.message).toContain("captions.fontSize would be its default");
		expect(error.message).not.toContain("caps");
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

	it("should leave a hand-edited line to the user, since the caps are checked against it", async () => {
		// GIVEN a ledger whose only line has its time written with an offset
		const ctx = testContext();
		writeLedger(ctx, `${line("2026-11-03T20:00:00-05:00", 0.1)}\n`);

		// WHEN it is read
		const error = await Effect.runPromise(Effect.flip(readLedger(ctx)));

		// THEN it fails on that line, and what to do with it is the user's decision
		expect(error.message).toContain("line 1 is corrupt");
		expect(error.fix).toContain("what to do with that line is the user's decision");
		expect(error.fix).not.toContain("Remove it");
	});

	it("should say to remove an unfinished last line, left by a write that was cut off", async () => {
		// GIVEN a good line, then a line that stops mid-way with no line end
		const ctx = testContext();
		const good = line("2026-11-04T08:00:00.000Z", 0.1);
		writeLedger(ctx, `${good}\n${line("2026-11-04T08:30:00.000Z", 0.2).slice(0, 40)}`);

		// WHEN it is read
		const error = await Effect.runPromise(Effect.flip(readLedger(ctx)));

		// THEN it fails on that line, and the fix says to remove it
		expect(error.message).toContain("line 2 is corrupt");
		expect(error.fix).toContain("Remove it");
		expect(error.fix).toContain("can't make the caps count less than was spent");
	});

	it("should leave a whole last line without a line end to the user, since no write was cut off", async () => {
		// GIVEN a hand-edited last line, valid JSON with a negative amount, and no line end
		const ctx = testContext();
		writeLedger(ctx, line("2026-11-04T08:00:00.000Z", -1));

		// WHEN it is read
		const error = await Effect.runPromise(Effect.flip(readLedger(ctx)));

		// THEN removing it isn't offered
		expect(error.fix).toContain("the user's decision");
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

describe("paidCall", () => {
	it("should keep a paid result when the ledger can't be written to close it", async () => {
		// GIVEN a paid call during which the ledger can't be written, as a full disk would act. A
		// folder in its place does that for every user, root included, unlike a read-only file.
		const ctx = testContext();
		const file = join(ctx.paths.data, "ledger.jsonl");
		const aside = `${file}.aside`;
		const work = Effect.sync(() => {
			renameSync(file, aside);
			mkdirSync(file);
			return "paid image";
		});

		// WHEN it runs
		const result = await Effect.runPromise(paidCall(ctx, call("a", 0.1), work)).finally(() => {
			rmSync(file, { recursive: true });
			renameSync(aside, file);
		});

		// THEN the result is kept
		expect(result).toBe("paid image");
		// AND the reservation, never closed, still counts it
		const entries = await Effect.runPromise(readLedger(ctx));
		expect(entries.map((entry) => entry.type)).toEqual(["reserve"]);
		expect(spent(entries, { post: "a" })).toBeCloseTo(0.1);
	});

	it("should free the reservation of a call that never left the machine", async () => {
		// GIVEN a paid call whose connection is refused before the request is sent
		const ctx = testContext();
		const refused = Effect.fail(
			failBecause(new NotSent({ message: "connect ECONNREFUSED", fix: "Tell the user." })),
		);

		// WHEN it runs
		const error = await Effect.runPromise(Effect.flip(paidCall(ctx, call("a", 0.1), refused)));

		// THEN it fails as a provider error
		expect(error.code).toBe("provider");
		// AND today's total is what it was before, since nothing was billed
		const entries = await Effect.runPromise(readLedger(ctx));
		expect(spent(entries, { since: daysNow(ctx).startOfToday })).toBe(0);
	});

	it("should keep counting a call whose outcome is unknown", async () => {
		// GIVEN a paid call whose connection drops after the request may have been sent
		const ctx = testContext();
		const dropped = Effect.fail(fail("provider", "socket hang up", "Run it again later."));

		// WHEN it runs
		await Effect.runPromise(Effect.flip(paidCall(ctx, call("a", 0.1), dropped)));

		// THEN its cost stays counted today
		const entries = await Effect.runPromise(readLedger(ctx));
		expect(spent(entries, { since: daysNow(ctx).startOfToday })).toBeCloseTo(0.1);
	});

	describe("budgetFor, for nothing to spend and for a batch", () => {
		it("should say a call of $0 fits, even while a setting can't be used", async () => {
			// GIVEN a setting that couldn't be used
			const ctx = testContext({
				settingsIssues: [BROKEN_CONFIG],
			});

			// WHEN a call with nothing to spend is checked
			const budget = await Effect.runPromise(budgetFor(ctx, { post: "a", usd: 0 }));

			// THEN it fits
			expect(budget.fits).toBe(true);
		});

		it("should count what a batch planned for earlier posts toward the day", async () => {
			// GIVEN a $1 daily cap and nothing spent
			const ctx = testContext({ config: { caps: { dailyUsd: 1, postUsd: 10 } } });

			// WHEN a $0.40 call is checked after $0.70 planned for earlier posts in the same dry run
			const budget = await Effect.runPromise(
				budgetFor(ctx, { post: "c", usd: 0.4 }, { plannedUsd: 0.7 }),
			);

			// THEN it doesn't fit today's cap
			expect(budget).toMatchObject({ fits: false, stoppedBy: "caps.dailyUsd" });
		});
	});
});
