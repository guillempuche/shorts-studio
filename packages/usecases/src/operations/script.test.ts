import { stageOf } from "@shorts-studio/domain/post";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { Context } from "../context.ts";
import { readPost } from "../post-store.ts";
import { tempDir, testContext } from "../test/context.ts";
import { run, runFailure } from "../test/fakes.ts";
import { seedPost } from "../test/posts.ts";
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
			scriptSet.run({ post: SLUG, file: folder, hook: undefined }, ctx, MODE),
		);

		// THEN it fails as a ShortsError, whose fix says to check the path
		expect(error.code).toBe("failed");
		expect(error.fix).toContain(folder);
	});
});
