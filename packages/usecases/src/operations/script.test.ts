import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { stageOf } from "@shorts-studio/domain/post";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { Context } from "../context.ts";
import { draftInputHash } from "../freshness.ts";
import { postDir, readPost } from "../post-store.ts";
import { tempDir, testContext } from "../test/context.ts";
import { run, runFailure } from "../test/fakes.ts";
import { approveAsIs, seedPost } from "../test/posts.ts";
import { scriptApprove, scriptSet } from "./script.ts";

const SLUG = "2026-11-07-approve";
const MODE = { dryRun: false, confirmed: true } as const;

/** A post with audio, a script and two prompted beats, waiting for the user's approval. */
const waitingForApproval = (ctx: Context) =>
	seedPost(ctx, SLUG, {
		script: { file: "script.md", hash: "s" },
		audio: {
			file: "audio/audio.m4a",
			hash: "a",
			origin: "mine",
			kind: "speech",
			durationSec: 4,
			source: "voice.m4a",
		},
		beats: {
			inputHash: "b",
			items: [
				{ index: 0, start: 0, end: 2, text: "one", prompt: "a red door" },
				{ index: 1, start: 2, end: 4, text: "two", prompt: "a blue sky" },
			],
		},
	});

const postOf = (ctx: Context) => Effect.runPromise(readPost(ctx, SLUG));

describe("script approve", () => {
	it("should record the script, the audio and every prompt the user approved", async () => {
		// GIVEN a post waiting for approval
		const ctx = testContext();
		await waitingForApproval(ctx);

		// WHEN the user approves it in their terminal
		await run(scriptApprove.run({ post: SLUG }, ctx, MODE));

		// THEN the approval names what images will be made from
		const script = (await postOf(ctx)).script;
		expect(script?.approvedHash).toBe("s");
		expect(script?.approvedAudio).toBe("a");
		expect(script?.approvedPrompts).toEqual(["a red door", "a blue sky"]);
		expect(stageOf(await postOf(ctx))).toBe("assets");
	});

	it("should approve nothing when no one is at a terminal, since the decision is the user's", async () => {
		// GIVEN a post waiting for approval, and a command run from an agent's shell
		const ctx = testContext({ interactive: false });
		await waitingForApproval(ctx);

		// WHEN the script is approved
		const error = await runFailure(scriptApprove.run({ post: SLUG }, ctx, MODE));

		// THEN it stays unapproved, and the user is asked to run it themselves
		expect(error.code).toBe("needs-approval");
		expect(error.fix).toContain("terminal");
		expect((await postOf(ctx)).script?.approvedHash).toBeUndefined();
		// AND the step is the user's, with the command and no tool
		expect(error.nextSteps[0]).toMatchObject({ by: "user", cli: `script approve --post ${SLUG}` });
		expect(error.nextSteps[0]?.tool).toBeUndefined();
	});

	it("should approve nothing in an agent's shell, even when it has a terminal", async () => {
		// GIVEN a post waiting for approval, and an agent's pseudo-terminal that carries its marker
		const ctx = testContext({ interactive: true, agentShell: "CLAUDECODE" });
		await waitingForApproval(ctx);

		// WHEN the script is approved
		const error = await runFailure(scriptApprove.run({ post: SLUG }, ctx, MODE));

		// THEN it stays unapproved, and the user is asked to use a terminal outside the agent
		expect(error.code).toBe("needs-approval");
		expect(error.fix).toContain("outside the agent");
		expect((await postOf(ctx)).script?.approvedHash).toBeUndefined();
	});
});

describe("script set", () => {
	it("should fail with a fix, not crash, when the path given is a folder", async () => {
		// GIVEN a post, and a folder passed where the script file goes
		const ctx = testContext();
		await waitingForApproval(ctx);
		const folder = tempDir();

		// WHEN the script is set from it
		const error = await runFailure(
			scriptSet.run({ post: SLUG, text: undefined, file: folder, hook: undefined }, ctx, MODE),
		);

		// THEN it is a usage error naming the folder
		expect(error.code).toBe("usage");
		expect(error.message).toBe(`${folder} is a folder.`);
	});
});

describe("script set, inline or from a file", () => {
	const set = (
		ctx: Context,
		input: { readonly text?: string; readonly file?: string; readonly hook?: string },
	) =>
		scriptSet.run({ post: SLUG, text: input.text, file: input.file, hook: input.hook }, ctx, MODE);
	const scriptFile = (ctx: Context) => join(postDir(ctx, SLUG), "script.md");

	it("should save a script passed inline", async () => {
		// GIVEN a post
		const ctx = testContext();
		await waitingForApproval(ctx);

		// WHEN its script is passed as text
		await run(set(ctx, { text: "# Morning\nA story.\n" }));

		// THEN script.md holds that text
		expect(readFileSync(scriptFile(ctx), "utf8")).toBe("# Morning\nA story.\n");
	});

	it("should refuse the text and a file together, saving nothing", async () => {
		// GIVEN a post, and a script file
		const ctx = testContext();
		await waitingForApproval(ctx);
		const file = join(tempDir(), "script.md");
		writeFileSync(file, "# From a file\n");

		// WHEN both are given
		const error = await runFailure(set(ctx, { text: "# Inline\n", file }));

		// THEN it is a usage error, and no script is saved
		expect(error.code).toBe("usage");
		expect(existsSync(scriptFile(ctx))).toBe(false);
	});

	it("should refuse no script at all, naming both forms", async () => {
		// GIVEN a post
		const ctx = testContext();
		await waitingForApproval(ctx);

		// WHEN neither the text nor a file is given
		const error = await runFailure(set(ctx, {}));

		// THEN it is a usage error whose fix names both forms
		expect(error.code).toBe("usage");
		expect(error.fix).toContain("--text <script>");
		expect(error.fix).toContain("--file <script.md>");
	});

	it("should name the full path of a relative file that isn't there", async () => {
		// GIVEN a post
		const ctx = testContext();
		await waitingForApproval(ctx);

		// WHEN its script is read from a relative path with no file
		const error = await runFailure(set(ctx, { file: "missing.md" }));

		// THEN it is not found, naming the full path it looked at
		expect(error.code).toBe("not-found");
		expect(error.message).toBe(`No file at ${resolve("missing.md")}.`);
	});

	it("should refuse an empty script, saving nothing", async () => {
		// GIVEN a post
		const ctx = testContext();
		await waitingForApproval(ctx);

		// WHEN its script is only blank lines
		const error = await runFailure(set(ctx, { text: " \n\n" }));

		// THEN it is a usage error, and no script is saved
		expect(error.code).toBe("usage");
		expect(existsSync(scriptFile(ctx))).toBe(false);
	});

	it("should refuse a hook of more than seven words", async () => {
		// GIVEN a post
		const ctx = testContext();
		await waitingForApproval(ctx);

		// WHEN the hook has nine words
		const error = await runFailure(
			set(ctx, { text: "# A\n", hook: "one two three four five six seven eight nine" }),
		);

		// THEN it is a usage error saying 3 to 7 words
		expect(error.code).toBe("usage");
		expect(error.fix).toContain("3 to 7 words");
	});

	it("should remove the hook when given an empty one", async () => {
		// GIVEN a post with a hook
		const ctx = testContext();
		await waitingForApproval(ctx);
		await run(set(ctx, { text: "# A\n", hook: "Wake up before the sun" }));

		// WHEN the hook is set to ""
		await run(set(ctx, { text: "# A\n", hook: "" }));

		// THEN the post has no hook
		expect((await postOf(ctx)).script?.hook).toBeUndefined();
	});

	it("should keep the approval when only the hook changes, and make the draft out of date", async () => {
		// GIVEN an approved post with a hook
		const ctx = testContext();
		await waitingForApproval(ctx);
		await run(set(ctx, { text: "# A\n", hook: "Wake up before the sun" }));
		await approveAsIs(ctx, SLUG);
		const before = draftInputHash(ctx, await postOf(ctx), 1);

		// WHEN only the hook changes
		const result = await run(set(ctx, { text: "# A\n", hook: "The sun waits for nobody" }));

		// THEN the script stays approved
		expect(result.approved).toBe(true);
		// AND the draft's inputs changed, so the next render makes it again
		expect(draftInputHash(ctx, await postOf(ctx), 1)).not.toBe(before);
	});
});
