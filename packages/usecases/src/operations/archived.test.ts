import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { readLedger } from "../ledger.ts";
import { readPost } from "../post-store.ts";
import { testContext } from "../test/context.ts";
import { runFailure } from "../test/fakes.ts";
import { seedUpToDate, withDraft } from "../test/posts.ts";
import { imageGenerate } from "./image.ts";
import { operations } from "./index.ts";

const SLUG = "2026-11-04-archived";
const MODE = { dryRun: false, confirmed: true } as const;

/** Commands that only read a post, or archive it, which an archived post still allows. */
const ALLOWED = new Set(["post_show", "post_archive"]);

/** Valid arguments for each operation that takes a post, given the files `files` names. */
const argumentsFor = (files: { script: string; audio: string; image: string; video: string }) =>
	({
		post_create: { post: SLUG },
		script_set: { post: SLUG, file: files.script },
		script_approve: { post: SLUG },
		source_import: { post: SLUG, file: files.audio, origin: "mine", kind: "speech" },
		audio_transcribe: { post: SLUG, force: false },
		beat_plan: { post: SLUG, byMoment: false, force: true },
		beat_set: { post: SLUG, beat: 0, prompt: "a green field" },
		image_generate: { post: SLUG, reroll: false },
		image_import: { post: SLUG, beat: 0, file: files.image },
		draft_render: { post: SLUG, force: true },
		post_review: { post: SLUG, decision: "approve" },
		capcut_export: { post: SLUG, mute: false },
		post_finalize: { post: SLUG, file: files.video },
		post_publish: { post: SLUG, platform: "instagram", url: "https://instagram.com/p/x" },
	}) as Readonly<Record<string, Record<string, unknown>>>;

/** Writes the user's own files outside the posts folder. */
const userFiles = (dir: string) => {
	mkdirSync(dir, { recursive: true });
	const write = (name: string) => {
		writeFileSync(join(dir, name), "x");
		return join(dir, name);
	};
	return {
		script: write("script.md"),
		audio: write("voice.m4a"),
		image: write("mine.png"),
		video: write("final.mp4"),
	};
};

describe("an archived post", () => {
	it("should refuse every command that changes it or spends on it, before anything happens", async () => {
		// GIVEN an approved post, up to date, that was archived
		const ctx = testContext();
		await seedUpToDate(ctx, SLUG, {
			...withDraft(),
			review: { decision: "approve", at: "2026-11-04T20:00:00.000Z", draftHash: "d1" },
			archivedAt: "2026-11-05T09:00:00.000Z",
		});
		const table = argumentsFor(userFiles(join(ctx.paths.data, "mine")));
		const before = (await Effect.runPromise(readPost(ctx, SLUG))).revision;
		const takesPost = operations.filter(
			(op) => op.params["post"] !== undefined && op.params["post"].optional !== true,
		);

		for (const op of takesPost.filter((op) => !ALLOWED.has(op.name))) {
			// WHEN each operation runs on it with valid arguments
			const input = table[op.name];
			expect(input, `${op.name} is missing from the table`).toBeDefined();
			const error = await runFailure(op.run(input ?? {}, ctx, MODE));

			// THEN it fails with conflict
			expect(error.code, op.name).toBe("conflict");
			// AND nothing was reserved, and post.json is unchanged
			expect(await Effect.runPromise(readLedger(ctx)), op.name).toEqual([]);
			expect((await Effect.runPromise(readPost(ctx, SLUG))).revision, op.name).toBe(before);
		}
	});

	it("should say it's archived when image generate is asked to spend on it", async () => {
		// GIVEN an archived post
		const ctx = testContext();
		await seedUpToDate(ctx, SLUG, { ...withDraft(), archivedAt: "2026-11-05T09:00:00.000Z" });

		// WHEN images are generated with --yes
		const error = await runFailure(
			imageGenerate.run(
				{ post: SLUG, beat: undefined, reroll: false, model: undefined },
				ctx,
				MODE,
			),
		);

		// THEN it fails with conflict, saying the post is archived
		expect(error.code).toBe("conflict");
		expect(error.message).toContain("is archived");
	});
});
