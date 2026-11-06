import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Effect, Exit } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { makeContext } from "../src/core/context.ts";
import { ShortsError } from "../src/core/errors.ts";
import { createPost, updatePost } from "../src/core/post-store.ts";
import { configCheck } from "../src/operations/config.ts";
import { postSchemaFile } from "../src/operations/schema.ts";
import { runCli } from "./support/cli.ts";
import { makeTestContext, type TestContext } from "./support/context.ts";

const root = join(import.meta.dirname, "..");
let ctx: TestContext;
afterEach(() => ctx?.cleanup());

describe("generated files", () => {
	it("should keep schemas/post.schema.json in step with the Post Schema", () => {
		// GIVEN the committed schema file
		const committed = JSON.parse(readFileSync(join(root, "schemas", "post.schema.json"), "utf8"));
		// WHEN it's compared with a fresh generation
		// THEN they match (fix: pnpm schemas)
		expect(committed).toEqual(postSchemaFile());
	});

	it("should report the version package.json declares", () => {
		// GIVEN the package version and the CLI's version constant
		const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { version: string };
		const main = readFileSync(join(root, "src", "main.ts"), "utf8");
		// WHEN they're compared
		// THEN they're the same
		expect(main).toContain(`export const VERSION = "${pkg.version}";`);
	});
});

describe("doctor", () => {
	it("should fail with each blocking problem and its fix", async () => {
		// GIVEN a machine with no ffmpeg and no keys
		ctx = makeTestContext({ run: () => Promise.reject(new Error("not found")) });
		// WHEN the check runs
		const exit = await Effect.runPromiseExit(
			configCheck.run({}, ctx, { dryRun: false, confirmed: true }),
		);
		// THEN it fails naming ffmpeg and the missing key, with fixes
		const found = Exit.isFailure(exit) ? Exit.findErrorOption(exit) : undefined;
		const error =
			found?._tag === "Some" && found.value instanceof ShortsError ? found.value : undefined;
		expect(error?.code).toBe("missing-tool");
		expect(error?.message).toContain("ffmpeg");
		expect(error?.message).toContain("FAL_KEY");
	});
});

describe("settings files", () => {
	it("should keep the defaults when config.json is invalid, and have doctor report it", async () => {
		// GIVEN a config.json with a cap that isn't a number
		ctx = makeTestContext();
		mkdirSync(ctx.paths.data, { recursive: true });
		writeFileSync(join(ctx.paths.data, "config.json"), '{ "caps": { "dailyUsd": "lots" } }');
		// WHEN the settings are loaded and doctor runs
		const loaded = makeContext({ SHORTS_DATA_DIR: ctx.paths.data });
		const exit = await Effect.runPromiseExit(
			configCheck.run(
				{},
				{
					...ctx,
					config: loaded.config,
					settingsIssues: loaded.settingsIssues,
					run: () => Promise.reject(new Error("not found")),
				},
				{ dryRun: false, confirmed: true },
			),
		);
		// THEN nothing crashed, the defaults apply, and doctor names the file
		expect(loaded.config).toEqual({});
		const found = Exit.isFailure(exit) ? Exit.findErrorOption(exit) : undefined;
		expect(
			found?._tag === "Some" && found.value instanceof ShortsError && found.value.message,
		).toContain("config.json");
	});
});

describe("batching posts on the CLI", () => {
	const seed = async () => {
		ctx = makeTestContext();
		for (const slug of ["2026-11-04-a", "2026-11-04-b", "2026-11-05-c"]) {
			await Effect.runPromise(createPost(ctx, { slug, createdAt: "x" }));
		}
		await Effect.runPromise(
			updatePost(ctx, "2026-11-04-b", "test", (post) =>
				Effect.succeed({ ...post, script: { file: "script.md", hash: "h" } }),
			),
		);
	};
	const slugsOf = (out: string) =>
		(JSON.parse(out) as { results: Array<{ post: string }> }).results.map((r) => r.post).sort();

	it("should run once per post in a comma-separated list", async () => {
		// GIVEN three posts
		await seed();
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
		await seed();
		// WHEN posts are selected by day, then by stage
		const byDay = await runCli(ctx, ["post", "show", "--day", "2026-11-04", "--json"]);
		const byStage = await runCli(ctx, ["post", "show", "--in-stage", "idea", "--json"]);
		// THEN the day's two posts, and the two without a script, are chosen
		expect(slugsOf(byDay.out)).toEqual(["2026-11-04-a", "2026-11-04-b"]);
		expect(slugsOf(byStage.out)).toEqual(["2026-11-04-a", "2026-11-05-c"]);
	});

	it("should say how many posts failed after printing each error", async () => {
		// GIVEN one real post
		await seed();
		// WHEN it's shown together with a post that doesn't exist
		const run = await runCli(ctx, ["post", "show", "--post", "2026-11-04-a,2026-11-04-nope"]);
		// THEN the run fails and its last words count the failures
		expect(run.ok).toBe(false);
		expect(run.err).toContain("1 of 2 posts failed.");
	});

	it("should refuse --dry-run on a command that spends nothing", async () => {
		// GIVEN a post
		await seed();
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

	it("should refuse to run without a post", async () => {
		// GIVEN posts exist
		await seed();
		// WHEN a post command gets no selection
		const run = await runCli(ctx, ["post", "show", "--json"]);
		// THEN it fails with a usage error that says how to choose
		expect(run.ok).toBe(false);
		expect(JSON.parse(run.out).error.code).toBe("usage");
	});
});
