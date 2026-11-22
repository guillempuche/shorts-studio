import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { NextStep } from "@shorts-studio/domain/next-step";
import { type Post, type Stage, stageOf } from "@shorts-studio/domain/post";
import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import type { Context } from "../context.ts";
import { toolInputSchema } from "../operation.ts";
import { readPost, updatePost } from "../post-store.ts";
import { testContext } from "../test/context.ts";
import { fakeImageMaker, fakePorts, run, runFailure } from "../test/fakes.ts";
import { approveAsIs } from "../test/posts.ts";
import { imageGenerate } from "./image.ts";
import { operations } from "./index.ts";

const SLUG = "2026-11-04-loop";

/** A file of the user's, outside the posts folder. */
const userFile = (ctx: Context, name: string, text: string): string => {
	const dir = join(ctx.paths.data, "mine");
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, name), text);
	return join(dir, name);
};

/**
 * Walks one post through every stage. It runs each agent step `nextSteps` names, as an MCP client
 * would call it, and stands in for the user's decisions with the test helpers.
 */
const walk = () => {
	const ctx = testContext();
	const maker = fakeImageMaker();
	const ports = fakePorts({ imageMaker: maker });
	let steps: ReadonlyArray<NextStep> = [];

	const postOf = (): Promise<Post> => Effect.runPromise(readPost(ctx, SLUG));
	const stage = async (): Promise<Stage> => stageOf(await postOf());

	/** Runs `step`'s tool with its arguments, the placeholders filled in from `fill`. */
	const follow = async (step: NextStep | undefined, fill: Record<string, unknown> = {}) => {
		expect(step?.by, JSON.stringify(step)).toBe("agent");
		const op = operations.find((candidate) => candidate.name === step?.tool);
		expect(op, step?.tool).toBeDefined();
		if (op === undefined || step === undefined) return;
		const { dryRun, ...input } = (await Effect.runPromise(
			Schema.decodeUnknownEffect(toolInputSchema(op))({ ...step.args, ...fill }),
		)) as Record<string, unknown>;
		const result = (await run(
			op.run(input, ctx, { dryRun: dryRun === true, confirmed: true }),
			ports,
		)) as { readonly nextSteps?: ReadonlyArray<NextStep> };
		steps = result.nextSteps ?? [];
	};

	/** The first step that isn't a note: what to run next. */
	const nextTool = () => steps.find((step) => step.tool !== undefined || step.cli !== undefined);

	/** The current post's next steps, as `post show` gives them. */
	const show = async () => follow({ by: "agent", tool: "post_show", args: { post: SLUG } });

	/** The user's decision on the draft, as `post review` records it. */
	const review = (
		decision: "approve" | "fix",
		beatNotes?: ReadonlyArray<{ beat: number; note: string }>,
	) =>
		Effect.runPromise(
			updatePost(ctx, SLUG, "test", (post) =>
				Effect.succeed({
					...post,
					review: {
						decision,
						at: ctx.now().toISOString(),
						draftHash: post.draft?.hash ?? "",
						...(beatNotes === undefined ? {} : { beatNotes }),
					},
				}),
			),
		);

	return { ctx, maker, ports, postOf, stage, follow, show, review, steps: () => steps, nextTool };
};

describe("the daily loop", () => {
	it("should move one post through every stage by following its next steps", async () => {
		const w = walk();
		const { ctx } = w;

		// GIVEN a new post with your own speech imported
		await w.follow({ by: "agent", tool: "post_create", args: { post: "loop" } });
		await w.follow(w.nextTool(), {
			file: userFile(ctx, "voice.m4a", "voice"),
			origin: "mine",
			kind: "speech",
		});
		expect(await w.stage()).toBe("idea");

		// WHEN its transcription's dry run runs, then the real run
		expect(w.nextTool()).toMatchObject({ tool: "audio_transcribe", args: { dryRun: true } });
		await w.follow(w.nextTool());
		expect(w.nextTool()).toMatchObject({ tool: "audio_transcribe", args: { post: SLUG } });
		await w.follow(w.nextTool());

		// AND its beats are planned, marked with moments, re-cut, and given prompts and a script
		expect(w.nextTool()?.tool).toBe("beat_plan");
		await w.follow(w.nextTool());
		const beats = (await w.postOf()).beats?.items ?? [];
		const moments = beats.map((b) => ({
			beat: b.index,
			moment: b.index < beats.length / 2 ? "hook" : "payoff",
		}));
		await w.follow(
			{ by: "agent", tool: "beat_set", args: { post: SLUG, beats: "<beats>" } },
			{ beats: moments },
		);
		expect(w.nextTool()).toMatchObject({ tool: "beat_plan", args: { byMoment: true } });
		await w.follow(w.nextTool());
		expect(w.nextTool()?.tool).toBe("beat_set");
		const recut = (await w.postOf()).beats?.items ?? [];
		const prompts = recut.map((b) => ({ beat: b.index, prompt: `a door, beat ${b.index}` }));
		// Inline, as an agent with only the MCP tools passes them.
		expect(w.nextTool()?.fill).toEqual(["beats"]);
		await w.follow(w.nextTool(), { beats: prompts });
		expect(w.nextTool()?.tool).toBe("script_set");
		expect(w.nextTool()?.fill).toEqual(["text"]);
		await w.follow(w.nextTool(), { text: "# Loop\n" });
		expect(await w.stage()).toBe("script-ready");

		// AND the user approves it, and the images' dry run, the images and the render run
		expect(w.nextTool()).toMatchObject({ by: "user", cli: `script approve --post ${SLUG}` });
		await approveAsIs(ctx, SLUG);
		await w.show();
		expect(w.nextTool()).toMatchObject({ tool: "image_generate", args: { dryRun: true } });
		await w.follow(w.nextTool());
		await w.follow(w.nextTool());
		expect(w.nextTool()?.tool).toBe("draft_render");
		await w.follow(w.nextTool());
		expect(await w.stage()).toBe("draft");

		// AND the user asks for a fix on beat 1, which gets a new prompt, approval and image
		await w.review("fix", [{ beat: 1, note: "too dark" }]);
		await w.show();
		expect(await w.stage()).toBe("needs-fix");
		expect(w.steps()[0]?.note).toContain('beat 1: "too dark"');
		await w.follow(
			{
				by: "agent",
				tool: "beat_set",
				args: { post: SLUG, prompt: "a brighter door" },
			},
			{ beat: 1 },
		);
		expect(w.nextTool()).toMatchObject({ by: "user", cli: `script approve --post ${SLUG}` });
		await approveAsIs(ctx, SLUG);
		await w.show();
		expect(w.nextTool()).toMatchObject({
			tool: "image_generate",
			args: { beat: "1", dryRun: true },
		});
		const submitted = w.maker.submits.length;
		await w.follow(w.nextTool());
		await w.follow(w.nextTool());
		expect(w.maker.submits.length - submitted).toBe(1);
		expect(w.nextTool()?.tool).toBe("draft_render");
		await w.follow(w.nextTool());
		expect(await w.stage()).toBe("draft");

		// AND the user approves the new draft, which is exported, finalized, published and archived
		await w.review("approve");
		await w.show();
		expect(await w.stage()).toBe("approved");
		expect(w.nextTool()?.tool).toBe("capcut_export");
		await w.follow(w.nextTool());
		const finalize = w.steps().find((step) => step.tool === "post_finalize");
		await w.follow(finalize, { file: userFile(ctx, "final.mp4", "final cut") });
		expect(await w.stage()).toBe("final");
		await w.follow(w.nextTool(), { platform: "instagram", url: "https://instagram.com/p/x" });
		expect(await w.stage()).toBe("posted");
		const archive = w.steps().find((step) => step.tool === "post_archive");
		await w.follow(archive);

		// THEN the post is archived, with nothing left to do, and spending on it is refused
		expect(await w.stage()).toBe("archived");
		expect(w.steps()).toEqual([]);
		const error = await runFailure(
			imageGenerate.run({ post: SLUG, beat: undefined, reroll: false, model: undefined }, ctx, {
				dryRun: true,
				confirmed: true,
			}),
			w.ports,
		);
		expect(error.code).toBe("conflict");
	});
});
