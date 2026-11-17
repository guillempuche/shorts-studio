import { cpSync } from "node:fs";
import type { Context } from "@shorts-studio/usecases/context";
import { readLedger, reserve } from "@shorts-studio/usecases/ledger";
import { commandPath, defineOperation, type Operation } from "@shorts-studio/usecases/operation";
import { configCheck } from "@shorts-studio/usecases/operations/config";
import { operations } from "@shorts-studio/usecases/operations/index";
import type { Ports } from "@shorts-studio/usecases/ports";
import { postDir, readPost } from "@shorts-studio/usecases/post-store";
import { BROKEN_CONFIG, testContext } from "@shorts-studio/usecases/test/context";
import { fakeImageMaker, fakePorts } from "@shorts-studio/usecases/test/fakes";
import { readyForImages, seedPost } from "@shorts-studio/usecases/test/posts";
import { DateTime, Effect, Exit, Fiber, Layer, Runtime, Schema } from "effect";
import { Command } from "effect/cli";
import { TestConsole } from "effect/testing";
import { describe, expect, it, vi } from "vitest";
import { aliasCommand, cliOutput, jsonRequested, nounCommands, root } from "./cli.ts";
import { platform } from "./platform.ts";

/**
 * Runs `shorts-studio <argv>` in this process with the given ports (in-memory fakes by default)
 * and returns what it printed and the exit code the runtime gives it, so tests check real
 * argument parsing and output.
 */
const runCli = (
	ctx: Context,
	argv: ReadonlyArray<string>,
	ports: Layer.Layer<Ports> = fakePorts(),
	ops: ReadonlyArray<Operation> = operations,
): Promise<{
	readonly ok: boolean;
	readonly exitCode: number;
	readonly out: string;
	readonly err: string;
}> =>
	Effect.runPromise(
		Effect.gen(function* () {
			const exit = yield* Effect.exit(cli(ctx, ops)([...argv]));
			let exitCode = -1;
			Runtime.defaultTeardown(exit, (code) => {
				exitCode = code;
			});
			return {
				ok: Exit.isSuccess(exit),
				exitCode,
				out: (yield* TestConsole.logLines).join("\n"),
				err: (yield* TestConsole.errorLines).join("\n"),
			};
		}).pipe(Effect.provide(Layer.mergeAll(platform, TestConsole.layer, ports, cliOutput(argv)))),
	);

/** The CLI with these operations, as main.ts builds it, less `mcp serve`. */
const cli = (ctx: Context, ops: ReadonlyArray<Operation>) =>
	Command.runWith(
		root.pipe(
			Command.withSubcommands([
				...nounCommands(ops, ctx),
				aliasCommand(configCheck, ctx, "doctor"),
			]),
		),
		{ version: "0.0.0" },
	);

/**
 * Runs `shorts-studio <argv>` like `runCli`, and interrupts it once `ready()` holds, as Ctrl-C
 * does. Returns what it printed and the exit code the runtime gives it, as main.ts does.
 */
const interruptCli = (
	ctx: Context,
	argv: ReadonlyArray<string>,
	ports: Layer.Layer<Ports>,
	ready: () => boolean,
): Promise<{ readonly exitCode: number; readonly out: string; readonly err: string }> =>
	Effect.runPromise(
		Effect.gen(function* () {
			const running = yield* Effect.forkChild(cli(ctx, operations)([...argv]));
			yield* Effect.promise(() => vi.waitUntil(ready));
			yield* Fiber.interrupt(running);
			let exitCode = -1;
			Runtime.defaultTeardown(yield* Fiber.await(running), (code) => {
				exitCode = code;
			});
			return {
				exitCode,
				out: (yield* TestConsole.logLines).join("\n"),
				err: (yield* TestConsole.errorLines).join("\n"),
			};
		}).pipe(Effect.provide(Layer.mergeAll(platform, TestConsole.layer, ports, cliOutput(argv)))),
	);

/** Three posts: two from 2026-11-04 (one with a script) and one from 2026-11-05. */
const threePosts = async () => {
	const ctx = testContext();
	await seedPost(ctx, "2026-11-04-a");
	await seedPost(ctx, "2026-11-04-b", { script: { file: "script.md", hash: "h" } });
	await seedPost(ctx, "2026-11-05-c");
	return ctx;
};

const slugsOf = (out: string) =>
	(JSON.parse(out) as { results: Array<{ post: string }> }).results.map((r) => r.post).sort();

describe("CLI output", () => {
	it("should print a single JSON object with --json", async () => {
		// GIVEN a post created through the CLI
		const ctx = testContext();
		await runCli(ctx, ["post", "create", "--post", "demo"]);

		// WHEN posts are listed as JSON
		const { out } = await runCli(ctx, ["post", "list", "--json"]);

		// THEN stdout is one JSON object holding the result
		const parsed = JSON.parse(out) as {
			ok: boolean;
			command: string;
			result: { posts: Array<{ slug: string }> };
		};
		expect(parsed.ok).toBe(true);
		expect(parsed.command).toBe("post list");
		expect(parsed.result.posts.map((p) => p.slug)).toEqual(["2026-11-04-demo"]);
	});

	it("should print the error's code, message and fix as JSON when a command fails", async () => {
		// GIVEN no posts
		const ctx = testContext();

		// WHEN a missing post is shown with --json
		const run = await runCli(ctx, ["post", "show", "--post", "nope", "--json"]);

		// THEN the run fails, and the JSON carries the error with its fix
		expect(run.ok).toBe(false);
		const parsed = JSON.parse(run.out) as { ok: boolean; error: { code: string; fix: string } };
		expect(parsed.ok).toBe(false);
		expect(parsed.error.code).toBe("not-found");
		expect(parsed.error.fix).toContain("post list");
	});

	it("should print one JSON error object, not help, when a command is called wrong with --json", async () => {
		// GIVEN no posts
		const ctx = testContext();

		// WHEN posts are listed with a flag that doesn't exist, asking for JSON
		const run = await runCli(ctx, ["post", "list", "--colour", "red", "--json"]);

		// THEN the run fails, and stdout holds only a usage error naming the command
		expect(run.ok).toBe(false);
		const parsed = JSON.parse(run.out) as {
			ok: boolean;
			command: string;
			error: { code: string; fix: string };
		};
		expect(parsed.ok).toBe(false);
		expect(parsed.command).toBe("post list");
		expect(parsed.error.code).toBe("usage");
		expect(parsed.error.fix).toContain("post list --help");
	});

	it.each([
		["--json=true", ["post", "list", "--colour", "red", "--json=true"]],
		["--json yes", ["post", "list", "--json", "yes", "--colour", "red"]],
	])(
		"should print one JSON error object when a command is called wrong with %s",
		async (_, argv) => {
			// GIVEN no posts
			const ctx = testContext();

			// WHEN posts are listed with a flag that doesn't exist, asking for JSON in another form
			const run = await runCli(ctx, argv);

			// THEN stdout holds only the usage error
			expect(run.ok).toBe(false);
			expect((JSON.parse(run.out) as { error: { code: string } }).error.code).toBe("usage");
		},
	);

	it("should print one JSON error object when a group of commands is given no command, with --json", async () => {
		// GIVEN no posts
		const ctx = testContext();

		// WHEN `post` is run with no command after it, asking for JSON
		const run = await runCli(ctx, ["post", "--json"]);

		// THEN stdout holds a usage error naming the group, instead of its help
		expect(run.ok).toBe(false);
		const parsed = JSON.parse(run.out) as { command: string; error: { code: string; fix: string } };
		expect(parsed.command).toBe("post");
		expect(parsed.error.code).toBe("usage");
		expect(parsed.error.fix).toContain("post --help");
	});

	it("should tell when --json is asked for, in each form the CLI reads as on", () => {
		// GIVEN the forms a boolean flag takes
		// WHEN each is checked
		// THEN only the ones that turn it on count
		expect(jsonRequested(["post", "list", "--json"])).toBe(true);
		expect(jsonRequested(["post", "list", "--json=yes"])).toBe(true);
		expect(jsonRequested(["post", "list", "--json", "--post", "x"])).toBe(true);
		expect(jsonRequested(["post", "list", "--json=false"])).toBe(false);
		expect(jsonRequested(["post", "list", "--json", "no"])).toBe(false);
		expect(jsonRequested(["post", "list"])).toBe(false);
	});

	it("should name doctor as doctor, the way it was called", async () => {
		// GIVEN no settings
		const ctx = testContext();

		// WHEN doctor runs with --json
		const run = await runCli(ctx, ["doctor", "--json"]);

		// THEN its object names the command as it was typed, as a usage error would
		expect((JSON.parse(run.out) as { command: string }).command).toBe("doctor");
	});

	it("should show a result through its text form without --json, whatever its JSON form", async () => {
		// GIVEN a command whose result can be shown as text but doesn't fit its own output Schema
		const ctx = testContext();
		const odd = defineOperation({
			name: "test_odd",
			description: "Returns a result its Schema doesn't take",
			params: {},
			output: Schema.Struct({ count: Schema.Int }),
			surface: "cli-only",
			spends: false,
			hints: { readonly: true, destructive: false, idempotent: true, openWorld: false },
			run: () => Effect.succeed({ count: 1.5 }),
			render: (o) => `count ${o.count}`,
		});

		// WHEN it runs without --json
		const run = await runCli(ctx, ["test", "odd"], fakePorts(), [odd]);

		// THEN its text is shown, since nothing asked for the JSON form
		expect(run.ok).toBe(true);
		expect(run.out).toBe("count 1.5");
	});

	it("should print the error and its fix on stderr without --json", async () => {
		// GIVEN no posts
		const ctx = testContext();

		// WHEN a missing post is shown
		const run = await runCli(ctx, ["post", "show", "--post", "nope"]);

		// THEN stdout stays empty, and stderr says what went wrong and what to do
		expect(run.ok).toBe(false);
		expect(run.out).toBe("");
		expect(run.err).toMatch(/^✗ No post "nope" in .+\n {2}→ List posts with: post list$/);
	});
});

describe("CLI commands", () => {
	it("should give every operation a noun-verb command", () => {
		// GIVEN the registry
		const ctx = testContext();

		// WHEN the CLI is built
		const nouns = new Set(nounCommands(operations, ctx).map((c) => c.name));

		// THEN each operation's noun is a command group
		for (const op of operations) expect(nouns.has(commandPath(op.name)[0]), op.name).toBe(true);
	});
});

describe("spending on the CLI", () => {
	it("should spend nothing and ask for --yes when a spending command runs without it", async () => {
		// GIVEN a post ready for images
		const ctx = testContext();
		await seedPost(ctx, "2026-11-04-spend", readyForImages());
		const maker = fakeImageMaker();

		// WHEN images are generated without --yes
		const run = await runCli(
			ctx,
			["image", "generate", "--post", "2026-11-04-spend"],
			fakePorts({ imageMaker: maker }),
		);

		// THEN it shows the estimate and fails asking for confirmation, with exit 3
		expect(run.ok).toBe(false);
		expect(run.exitCode).toBe(3);
		expect(run.out).toContain("Would generate 2 images");
		expect(run.err).toContain("spends money; nothing was spent.");
		// AND nothing reached the provider
		expect(maker.submits).toHaveLength(0);
	});

	it("should fail over the cap without --yes, as the real run would, with exit 4", async () => {
		// GIVEN a post ready for images, and a daily cap below what they cost
		const ctx = testContext({ config: { caps: { dailyUsd: 0.001 } } });
		await seedPost(ctx, "2026-11-04-spend", readyForImages());
		const maker = fakeImageMaker();

		// WHEN images are generated without --yes
		const run = await runCli(
			ctx,
			["image", "generate", "--post", "2026-11-04-spend", "--json"],
			fakePorts({ imageMaker: maker }),
		);

		// THEN it fails with over-budget, not needs-confirmation, and exits 4
		const output = JSON.parse(run.out);
		expect(output.error.code).toBe("over-budget");
		expect(output.error.fix).toContain("caps.dailyUsd");
		expect(run.exitCode).toBe(4);
		// AND nothing was reserved or sent
		expect(maker.submits).toHaveLength(0);
		expect(await Effect.runPromise(readLedger(ctx))).toHaveLength(0);
	});

	it("should fail with missing-key without --yes when the key isn't set, with exit 1", async () => {
		// GIVEN a post ready for images, and an image provider whose key isn't set
		const ctx = testContext();
		await seedPost(ctx, "2026-11-04-spend", readyForImages());
		const maker = fakeImageMaker({ keys: [{ env: "FAKE_IMAGES_KEY", keychain: "fake-images" }] });

		// WHEN images are generated without --yes
		const run = await runCli(
			ctx,
			["image", "generate", "--post", "2026-11-04-spend", "--json"],
			fakePorts({ imageMaker: maker }),
		);

		// THEN it fails with missing-key, naming the key, and exits 1
		const output = JSON.parse(run.out);
		expect(output.error.code).toBe("missing-key");
		expect(output.error.message).toContain("FAKE_IMAGES_KEY");
		expect(run.exitCode).toBe(1);
	});

	it("should fail with failed without --yes while a setting can't be used, with exit 1", async () => {
		// GIVEN a post ready for images, and a config.json that couldn't be used
		const ctx = testContext({ settingsIssues: [BROKEN_CONFIG] });
		await seedPost(ctx, "2026-11-04-spend", readyForImages());

		// WHEN images are generated without --yes
		const run = await runCli(ctx, ["image", "generate", "--post", "2026-11-04-spend", "--json"]);

		// THEN it fails with failed, naming the setting, and exits 1
		const output = JSON.parse(run.out);
		expect(output.error.code).toBe("failed");
		expect(output.error.message).toContain("/data/config.json");
		expect(run.exitCode).toBe(1);
	});

	it("should fetch saved requests without --yes, since that spends nothing", async () => {
		// GIVEN a post whose two beats' requests were sent and saved, then cut short by Ctrl-C
		const ctx = testContext();
		await seedPost(ctx, "2026-11-04-spend", readyForImages());
		const maker = fakeImageMaker();
		maker.answer = "never";
		const ports = fakePorts({ imageMaker: maker });
		await interruptCli(
			ctx,
			["image", "generate", "--post", "2026-11-04-spend", "--yes"],
			ports,
			() => maker.waits === 2,
		);
		maker.answer = "image";

		// WHEN images are generated without --yes
		const run = await runCli(ctx, ["image", "generate", "--post", "2026-11-04-spend"], ports);

		// THEN both images are fetched and saved, no new request is sent, and it exits 0
		expect(run.exitCode).toBe(0);
		const post = await Effect.runPromise(readPost(ctx, "2026-11-04-spend"));
		expect(post.beats?.items.every((b) => b.image !== undefined)).toBe(true);
		expect(maker.submits).toHaveLength(2);
		expect(run.out).toContain("resumed 2");
	});

	it("should give each post of a batch its own outcome without --yes", async () => {
		// GIVEN two posts ready for images ($0.02 each) and a $0.03 daily cap, which fits one
		const ctx = testContext({ config: { caps: { dailyUsd: 0.03, postUsd: 1 } } });
		await seedPost(ctx, "2026-11-04-one", readyForImages());
		await seedPost(ctx, "2026-11-04-two", readyForImages());

		// WHEN both are generated without --yes
		const run = await runCli(ctx, [
			"image",
			"generate",
			"--post",
			"2026-11-04-one,2026-11-04-two",
			"--json",
		]);

		// THEN the first shows its estimate, and the second fails over the cap
		const output = JSON.parse(run.out) as {
			results: Array<{ ok: boolean; result?: { dryRun: boolean }; error?: { code: string } }>;
		};
		expect(output.results[0]).toMatchObject({ ok: true, result: { dryRun: true } });
		expect(output.results[1]).toMatchObject({ ok: false, error: { code: "over-budget" } });
	});

	it("should print one JSON object holding the estimate and the error when --yes is missing", async () => {
		// GIVEN a post ready for images
		const ctx = testContext();
		await seedPost(ctx, "2026-11-04-spend", readyForImages());

		// WHEN images are generated with --json but without --yes
		const run = await runCli(ctx, ["image", "generate", "--post", "2026-11-04-spend", "--json"]);

		// THEN stdout holds exactly one object
		const lines = run.out.split("\n").filter((line) => line.trim() !== "");
		expect(lines).toHaveLength(1);
		// AND it carries both the estimate and the request for confirmation
		const output = JSON.parse(lines[0] ?? "");
		expect(output.ok).toBe(false);
		expect(output.result.planned).toHaveLength(2);
		expect(output.error.code).toBe("needs-confirmation");
	});

	it("should name a setting that can't be used on stderr, and still run a command that spends nothing", async () => {
		// GIVEN a config.json setting that couldn't be used
		const ctx = testContext({ settingsIssues: [BROKEN_CONFIG] });

		// WHEN the budget is shown as JSON
		const run = await runCli(ctx, ["budget", "show", "--json"]);

		// THEN it runs, and stdout still holds only its one object
		expect(run.ok).toBe(true);
		expect(JSON.parse(run.out).ok).toBe(true);
		// AND stderr names the file and the problem
		expect(run.err).toContain('/data/config.json: captions.fontSize: Expected a number, got "big"');
	});

	it("should add up a batch dry run, so the posts that together pass the cap don't all fit", async () => {
		// GIVEN two posts ready for images ($0.02 each) and a $0.03 daily cap, which fits one
		const ctx = testContext({ config: { caps: { dailyUsd: 0.03, postUsd: 1 } } });
		await seedPost(ctx, "2026-11-04-one", readyForImages());
		await seedPost(ctx, "2026-11-04-two", readyForImages());

		// WHEN both are planned in one dry run
		const run = await runCli(ctx, [
			"image",
			"generate",
			"--post",
			"2026-11-04-one,2026-11-04-two",
			"--dry-run",
			"--json",
		]);

		// THEN the first fits, and the second doesn't, counting what the first planned
		const fits = JSON.parse(run.out).results.map(
			(r: { result: { budget: { fits: boolean } } }) => r.result.budget.fits,
		);
		expect(fits).toEqual([true, false]);
	});

	it("should not count a post that can't go ahead toward the next posts of a batch dry run", async () => {
		// GIVEN $0.01 already spent on the first post, a $0.025 per-post cap it would pass, and a
		// $0.035 daily cap that fits the second post's $0.02 only if the first doesn't count
		const ctx = testContext({ config: { caps: { dailyUsd: 0.035, postUsd: 0.025 } } });
		await seedPost(ctx, "2026-11-04-one", readyForImages());
		await seedPost(ctx, "2026-11-04-two", readyForImages());
		await Effect.runPromise(
			reserve(ctx, {
				provider: "fake-images",
				model: "fake-fast",
				post: "2026-11-04-one",
				unit: "image",
				units: 1,
				usdPerUnit: 0.01,
				usd: 0.01,
			}),
		);

		// WHEN both are planned in one dry run
		const run = await runCli(ctx, [
			"image",
			"generate",
			"--post",
			"2026-11-04-one,2026-11-04-two",
			"--dry-run",
			"--json",
		]);

		// THEN the first doesn't fit its post's cap, and the second still fits the day's
		const fits = JSON.parse(run.out).results.map(
			(r: { result: { budget: { fits: boolean } } }) => r.result.budget.fits,
		);
		expect(fits).toEqual([false, true]);
	});

	it("should not warn about settings on doctor, which lists them itself", async () => {
		// GIVEN a setting that couldn't be used
		const ctx = testContext({
			settingsIssues: [BROKEN_CONFIG],
		});

		// WHEN doctor runs
		const run = await runCli(ctx, ["doctor", "--json"]);

		// THEN stderr carries no warning line, since doctor's own result names the setting
		expect(run.err).not.toContain("A setting can't be used");
	});

	it("should say a dry run won't fit today's cap, and still succeed, since it spent nothing", async () => {
		// GIVEN a post ready for images, and a daily cap below what they cost
		const ctx = testContext({ config: { caps: { dailyUsd: 0.001 } } });
		await seedPost(ctx, "2026-11-04-spend", readyForImages());

		// WHEN images are planned with --dry-run
		const run = await runCli(ctx, [
			"image",
			"generate",
			"--post",
			"2026-11-04-spend",
			"--dry-run",
			"--json",
		]);

		// THEN it succeeds, and its budget says the estimate doesn't fit, naming the daily cap
		expect(run.ok).toBe(true);
		const output = JSON.parse(run.out);
		expect(output.result.budget).toMatchObject({ fits: false, stoppedBy: "caps.dailyUsd" });
	});

	it("should spend once --yes is given", async () => {
		// GIVEN a post ready for images
		const ctx = testContext();
		await seedPost(ctx, "2026-11-04-spend", readyForImages());
		const maker = fakeImageMaker();

		// WHEN images are generated with --yes
		const run = await runCli(
			ctx,
			["image", "generate", "--post", "2026-11-04-spend", "--yes"],
			fakePorts({ imageMaker: maker }),
		);

		// THEN both images were paid for
		expect(run.ok).toBe(true);
		expect(maker.submits).toHaveLength(2);
	});
});

describe("interrupting a run on the CLI", () => {
	it("should print one JSON object with code interrupted when a run is interrupted, and exit 130", async () => {
		// GIVEN a post ready for images, and a provider that never sends the images back
		const ctx = testContext();
		await seedPost(ctx, "2026-11-04-spend", readyForImages());
		const maker = fakeImageMaker();
		maker.answer = "never";

		// WHEN images are generated with --json, and the run is interrupted while it waits
		const run = await interruptCli(
			ctx,
			["image", "generate", "--post", "2026-11-04-spend", "--yes", "--json"],
			fakePorts({ imageMaker: maker }),
			() => maker.waits === 2,
		);

		// THEN stdout holds one object, with code interrupted
		const output = JSON.parse(run.out) as { ok: boolean; error: { code: string; fix: string } };
		expect(output.ok).toBe(false);
		expect(output.error.code).toBe("interrupted");
		// AND its fix says to run the same command again, without --reroll, to resume
		expect(output.error.fix).toContain("Run the same image generate command again");
		expect(output.error.fix).toContain("fetched without paying again; leave out --reroll");
		// AND the run exits 130
		expect(run.exitCode).toBe(130);
	});

	it("should print an interrupted run's error and fix on stderr without --json", async () => {
		// GIVEN a post ready for images, and a provider that never sends the images back
		const ctx = testContext();
		await seedPost(ctx, "2026-11-04-spend", readyForImages());
		const maker = fakeImageMaker();
		maker.answer = "never";

		// WHEN images are generated, and the run is interrupted while it waits
		const run = await interruptCli(
			ctx,
			["image", "generate", "--post", "2026-11-04-spend", "--yes"],
			fakePorts({ imageMaker: maker }),
			() => maker.waits === 2,
		);

		// THEN stderr ends with the error and its fix, and stdout stays empty
		expect(run.out).toBe("");
		expect(run.err).toContain("✗ image generate was interrupted.\n  → Run the same image generate");
		expect(run.exitCode).toBe(130);
	});
});

describe("batching posts on the CLI", () => {
	it("should run once per post in a comma-separated list", async () => {
		// GIVEN three posts
		const ctx = await threePosts();

		// WHEN two are shown at once
		const run = await runCli(ctx, [
			"post",
			"show",
			"--post",
			"2026-11-04-a,2026-11-05-c",
			"--json",
		]);

		// THEN both results come back
		expect(slugsOf(run.out)).toEqual(["2026-11-04-a", "2026-11-05-c"]);
	});

	it("should select posts by the day they were created and by stage", async () => {
		// GIVEN three posts, one with a script
		const ctx = await threePosts();

		// WHEN posts are selected by day, then by stage
		const byDay = await runCli(ctx, ["post", "show", "--day", "2026-11-04", "--json"]);
		const byStage = await runCli(ctx, ["post", "show", "--in-stage", "idea", "--json"]);

		// THEN the day's two posts, then the two without a script, are chosen
		expect(slugsOf(byDay.out)).toEqual(["2026-11-04-a", "2026-11-04-b"]);
		expect(slugsOf(byStage.out)).toEqual(["2026-11-04-a", "2026-11-05-c"]);
	});

	it("should select today's posts with --day today", async () => {
		// GIVEN three posts, and today is 2026-11-04
		const ctx = await threePosts();

		// WHEN today's posts are shown
		const run = await runCli(ctx, ["post", "show", "--day", "today", "--json"]);

		// THEN the two from 2026-11-04 are chosen
		expect(slugsOf(run.out)).toEqual(["2026-11-04-a", "2026-11-04-b"]);
	});

	it("should take today as the local day with --day today", async () => {
		// GIVEN three posts, and a machine in Madrid at 00:30 on 5 November (still 4 November in UTC)
		const ctx = {
			...(await threePosts()),
			timeZone: DateTime.zoneMakeNamedUnsafe("Europe/Madrid"),
			now: () => new Date("2026-11-04T23:30:00Z"),
		};

		// WHEN today's posts are shown
		const run = await runCli(ctx, ["post", "show", "--day", "today", "--json"]);

		// THEN only the post from 5 November is chosen, so it runs as a single post
		expect((JSON.parse(run.out) as { result: { slug: string } }).result.slug).toBe("2026-11-05-c");
	});

	it("should select a copied post folder by its own name, not the name its post.json carries", async () => {
		// GIVEN a post, and a copy of its folder under another name from the same day
		const ctx = await threePosts();
		cpSync(postDir(ctx, "2026-11-04-a"), postDir(ctx, "2026-11-04-copy"), { recursive: true });

		// WHEN that day's posts are shown, and listed
		const shown = await runCli(ctx, ["post", "show", "--day", "2026-11-04", "--json"]);
		const listed = await runCli(ctx, ["post", "list", "--json"]);

		// THEN the copy is selected by its folder's name, and the original only once
		expect(slugsOf(shown.out)).toEqual(["2026-11-04-a", "2026-11-04-b", "2026-11-04-copy"]);
		expect(
			(JSON.parse(listed.out) as { result: { posts: Array<{ slug: string }> } }).result.posts
				.map((post) => post.slug)
				.sort(),
		).toEqual(["2026-11-04-a", "2026-11-04-b", "2026-11-04-copy", "2026-11-05-c"]);
	});

	it("should say how many posts failed after printing each error", async () => {
		// GIVEN one real post
		const ctx = await threePosts();

		// WHEN it's shown together with a post that doesn't exist
		const run = await runCli(ctx, ["post", "show", "--post", "2026-11-04-a,2026-11-04-nope"]);

		// THEN the real post is shown and the missing one's error printed
		expect(run.out).toContain("── 2026-11-04-a");
		expect(run.err).toContain('No post "2026-11-04-nope"');
		// AND the run fails, its last words counting the failures
		expect(run.ok).toBe(false);
		expect(run.err).toContain("1 of 2 posts failed.");
	});

	it("should give a batch that partly failed the documented error object with --json", async () => {
		// GIVEN one real post
		const ctx = await threePosts();

		// WHEN it's shown as JSON together with a post that doesn't exist
		const run = await runCli(ctx, [
			"post",
			"show",
			"--post",
			"2026-11-04-a,2026-11-04-nope",
			"--json",
		]);

		// THEN the one object holds each post's outcome and the error the run ended with
		const parsed = JSON.parse(run.out) as {
			ok: boolean;
			results: Array<{ post: string; ok: boolean }>;
			error: { code: string; message: string };
		};
		expect(parsed.ok).toBe(false);
		expect(parsed.results.map((r) => r.ok)).toEqual([true, false]);
		expect(parsed.error.code).toBe("failed");
		expect(parsed.error.message).toBe("1 of 2 posts failed.");
	});

	it("should refuse --dry-run on a command that spends nothing", async () => {
		// GIVEN a post
		const ctx = await threePosts();

		// WHEN a non-spending command is given --dry-run
		const run = await runCli(ctx, [
			"post",
			"show",
			"--post",
			"2026-11-04-a",
			"--dry-run",
			"--json",
		]);

		// THEN it does nothing and says it's a usage error
		expect(run.ok).toBe(false);
		expect(JSON.parse(run.out).error.code).toBe("usage");
	});

	it("should take --dry-run on transcription, which spends, and run it without --yes", async () => {
		// GIVEN a post with two minutes of audio
		const ctx = testContext();
		await seedPost(ctx, "2026-11-04-talk", {
			audio: {
				file: "audio/audio.m4a",
				hash: "a",
				origin: "mine",
				kind: "speech",
				durationSec: 120,
				source: "talk.m4a",
			},
		});
		const args = ["audio", "transcribe", "--post", "2026-11-04-talk", "--json"];

		// WHEN its audio is transcribed as a dry run, then for real without --yes
		const dry = await runCli(ctx, [...args, "--dry-run"]);
		const real = await runCli(ctx, args);

		// THEN the dry run reports the estimate, and the real run transcribes
		expect(dry.ok).toBe(true);
		expect(JSON.parse(dry.out).result).toMatchObject({ dryRun: true, words: 0 });
		expect(real.ok).toBe(true);
		expect(JSON.parse(real.out).result).toMatchObject({ dryRun: false, words: 2 });
	});

	it("should refuse to run without a post", async () => {
		// GIVEN posts exist
		const ctx = await threePosts();

		// WHEN a post command gets no selection
		const run = await runCli(ctx, ["post", "show", "--json"]);

		// THEN it fails with a usage error that says how to choose
		expect(run.ok).toBe(false);
		const error = JSON.parse(run.out).error as { code: string; fix: string };
		expect(error.code).toBe("usage");
		expect(error.fix).toContain("--post");
	});

	it("should refuse a day that isn't a date", async () => {
		// GIVEN posts exist
		const ctx = await threePosts();

		// WHEN posts are selected by a day written in words
		const run = await runCli(ctx, ["post", "show", "--day", "yesterday", "--json"]);

		// THEN it is a usage error
		expect(run.ok).toBe(false);
		expect(JSON.parse(run.out).error.code).toBe("usage");
	});
});
