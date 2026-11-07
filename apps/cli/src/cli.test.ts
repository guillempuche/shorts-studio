import * as NodeChildProcessSpawner from "@effect/platform-node-shared/NodeChildProcessSpawner";
import * as NodeFileSystem from "@effect/platform-node-shared/NodeFileSystem";
import * as NodePath from "@effect/platform-node-shared/NodePath";
import * as NodeStdio from "@effect/platform-node-shared/NodeStdio";
import * as NodeTerminal from "@effect/platform-node-shared/NodeTerminal";
import type { Context } from "@shorts-studio/usecases/context";
import { commandPath } from "@shorts-studio/usecases/operation";
import { operations } from "@shorts-studio/usecases/operations/index";
import type { Ports } from "@shorts-studio/usecases/ports";
import { testContext } from "@shorts-studio/usecases/test/context";
import { fakeImageMaker, fakePorts } from "@shorts-studio/usecases/test/fakes";
import { readyForImages, seedPost } from "@shorts-studio/usecases/test/posts";
import { Effect, Exit, Layer } from "effect";
import { Command } from "effect/cli";
import { TestConsole } from "effect/testing";
import { describe, expect, it } from "vitest";
import { nounCommands, root } from "./cli.ts";

const platform = Layer.mergeAll(
	NodeFileSystem.layer,
	NodePath.layer,
	NodeTerminal.layer,
	NodeStdio.layer,
	NodeChildProcessSpawner.layer.pipe(
		Layer.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)),
	),
	TestConsole.layer,
);

/**
 * Runs `shorts-studio <argv>` in this process with the given ports (in-memory fakes by default)
 * and returns what it printed, so tests check real argument parsing and output.
 */
const runCli = (
	ctx: Context,
	argv: ReadonlyArray<string>,
	ports: Layer.Layer<Ports> = fakePorts(),
): Promise<{ readonly ok: boolean; readonly out: string; readonly err: string }> =>
	Effect.runPromise(
		Effect.gen(function* () {
			const program = root.pipe(Command.withSubcommands(nounCommands(operations, ctx)));
			const exit = yield* Effect.exit(Command.runWith(program, { version: "0.0.0" })([...argv]));
			return {
				ok: Exit.isSuccess(exit),
				out: (yield* TestConsole.logLines).join("\n"),
				err: (yield* TestConsole.errorLines).join("\n"),
			};
			// The layers below provide everything the CLI needs. The cast just drops that from the type.
		}).pipe(Effect.provide(Layer.mergeAll(platform, ports))) as Effect.Effect<{
			readonly ok: boolean;
			readonly out: string;
			readonly err: string;
		}>,
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

		// THEN it shows the estimate and fails asking for confirmation
		expect(run.ok).toBe(false);
		expect(run.out).toContain("Would generate 2 images");
		expect(run.err).toContain("spends money; nothing was spent.");
		// AND nothing reached the provider
		expect(maker.submits).toHaveLength(0);
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
