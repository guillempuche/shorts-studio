import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Effect, Exit } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { ShortsError } from "../src/core/errors.ts";
import { createPost, postDir, readPost, updatePost } from "../src/core/post-store.ts";
import { type Post, stageOf } from "../src/domain/post.ts";
import { capcutExport } from "../src/operations/capcut.ts";
import { imageGenerate } from "../src/operations/image.ts";
import { imageImport } from "../src/operations/image-import.ts";
import { postArchive, postFinalize, postPublish, postReview } from "../src/operations/lifecycle.ts";
import { postList } from "../src/operations/post.ts";
import { sourceAdopt } from "../src/operations/source-download.ts";
import { makeTestContext, type TestContext } from "./support/context.ts";
import { type FakeFal, startFakeFal } from "./support/fake-fal.ts";

const SLUG = "2026-11-05-life";
const MODE = { dryRun: false, confirmed: true } as const;
let ctx: TestContext;
let fake: FakeFal | undefined;
afterEach(async () => {
	await fake?.close();
	fake = undefined;
	ctx?.cleanup();
});

const errorOf = (exit: Exit.Exit<unknown, unknown>): ShortsError | undefined => {
	const found = Exit.isFailure(exit) ? Exit.findErrorOption(exit) : undefined;
	return found?._tag === "Some" && found.value instanceof ShortsError ? found.value : undefined;
};

/** A post with a rendered draft and two beats with images. */
const withDraft = async (draftHash = "d1") => {
	await Effect.runPromise(createPost(ctx, { slug: SLUG, createdAt: "x" }));
	await Effect.runPromise(
		updatePost(
			ctx,
			SLUG,
			"test",
			(post): Effect.Effect<Post> =>
				Effect.succeed({
					...post,
					script: { file: "script.md", hash: "s", approvedHash: "s" },
					audio: {
						file: "audio/audio.m4a",
						hash: "a",
						origin: "mine",
						kind: "speech",
						durationSec: 4,
						source: "x",
					},
					beats: {
						inputHash: "b",
						items: [
							{
								index: 0,
								start: 0,
								end: 2,
								text: "one",
								prompt: "a door",
								image: {
									file: "images/beat-00.jpg",
									hash: "i0",
									inputHash: "h0",
									provider: "fal",
									model: "m",
									seed: 1,
									source: "generated",
								},
							},
							{
								index: 1,
								start: 2,
								end: 4,
								text: "two",
								prompt: "a sky",
								image: {
									file: "images/beat-01.jpg",
									hash: "i1",
									inputHash: "h1",
									provider: "fal",
									model: "m",
									seed: 1,
									source: "generated",
								},
							},
						],
					},
					draft: {
						file: "draft.mp4",
						hash: draftHash,
						inputHash: "x",
						rendererVersion: 2,
						durationSec: 4,
					},
				}),
		),
	);
};

const review = (
	decision: "approve" | "fix" | "reject",
	extra: { beatNotes?: string; animate?: string } = {},
) =>
	postReview.run(
		{ post: SLUG, decision, note: undefined, beatNotes: extra.beatNotes, animate: extra.animate },
		ctx,
		MODE,
	);

describe("the evening review", () => {
	it("should move an approved draft to approved, with notes and beats to animate", async () => {
		// GIVEN a post with a draft
		ctx = makeTestContext();
		await withDraft();
		// WHEN the user approves it, marking beat 1 for animation
		await Effect.runPromise(review("approve", { beatNotes: "0:warmer light", animate: "1" }));
		// THEN the post is approved and keeps the notes
		const post = await Effect.runPromise(readPost(ctx, SLUG));
		expect(stageOf(post)).toBe("approved");
		expect(post.review?.beatNotes).toEqual([{ beat: 0, note: "warmer light" }]);
		expect(post.review?.animate).toEqual([1]);
	});

	it("should stop counting a review once the draft is rendered again", async () => {
		// GIVEN an approved draft
		ctx = makeTestContext();
		await withDraft("d1");
		await Effect.runPromise(review("approve"));
		// WHEN the draft is re-rendered (its hash changes)
		await Effect.runPromise(
			updatePost(ctx, SLUG, "test", (post) =>
				Effect.succeed({
					...post,
					draft: {
						file: "draft.mp4",
						hash: "d2",
						inputHash: "y",
						rendererVersion: 2,
						durationSec: 4,
					},
				}),
			),
		);
		// THEN it's back to waiting for a review
		expect(stageOf(await Effect.runPromise(readPost(ctx, SLUG)))).toBe("draft");
	});

	it("should refuse notes for a beat that doesn't exist", async () => {
		// GIVEN a post with beats 0 and 1
		ctx = makeTestContext();
		await withDraft();
		// WHEN a note names beat 7
		const error = errorOf(await Effect.runPromiseExit(review("fix", { beatNotes: "7:too dark" })));
		// THEN it's a usage error and nothing is recorded
		expect(error?.code).toBe("usage");
		expect((await Effect.runPromise(readPost(ctx, SLUG))).review).toBeUndefined();
	});
});

describe("after approval", () => {
	it("should refuse to finalize or export a draft the user hasn't approved", async () => {
		// GIVEN a draft marked for fixing
		ctx = makeTestContext();
		await withDraft();
		await Effect.runPromise(review("fix"));
		const video = join(ctx.paths.data, "final.mp4");
		mkdirSync(ctx.paths.data, { recursive: true });
		writeFileSync(video, "x");
		// WHEN it's finalized and exported
		const finalize = errorOf(
			await Effect.runPromiseExit(postFinalize.run({ post: SLUG, file: video }, ctx, MODE)),
		);
		const exported = errorOf(
			await Effect.runPromiseExit(capcutExport.run({ post: SLUG, mute: false }, ctx, MODE)),
		);
		// THEN both wait for the user's approval
		expect(finalize?.code).toBe("needs-confirmation");
		expect(exported?.code).toBe("needs-confirmation");
	});

	it("should keep one record per platform and hide archived posts from the list", async () => {
		// GIVEN a post published on Instagram
		ctx = makeTestContext();
		await withDraft();
		await Effect.runPromise(
			postPublish.run(
				{ post: SLUG, platform: "instagram", url: "https://instagram.com/p/old" },
				ctx,
				MODE,
			),
		);
		// WHEN the Instagram URL is recorded again and the post archived
		await Effect.runPromise(
			postPublish.run(
				{ post: SLUG, platform: "instagram", url: "https://instagram.com/p/new" },
				ctx,
				MODE,
			),
		);
		await Effect.runPromise(postArchive.run({ post: SLUG }, ctx, MODE));
		// THEN one Instagram record remains, and post list shows it only when asked for archived posts
		const post = await Effect.runPromise(readPost(ctx, SLUG));
		expect(post.published).toHaveLength(1);
		expect(post.published?.[0]?.url).toBe("https://instagram.com/p/new");
		expect(
			(await Effect.runPromise(postList.run({ stage: undefined }, ctx, MODE))).posts,
		).toHaveLength(0);
		expect(
			(await Effect.runPromise(postList.run({ stage: "archived" }, ctx, MODE))).posts,
		).toHaveLength(1);
	});
});

describe("imported images", () => {
	it("should keep an imported image when the other beats are generated", async () => {
		// GIVEN a post ready for images, with a Midjourney image imported for beat 0
		fake = await startFakeFal();
		ctx = makeTestContext({
			endpoints: { fal: fake.url, together: "http://127.0.0.1:1" },
			secrets: { FAL_KEY: "test" },
		});
		await withDraft();
		await Effect.runPromise(
			updatePost(
				ctx,
				SLUG,
				"test",
				(post) =>
					Effect.succeed({
						...post,
						beats: post.beats && {
							...post.beats,
							items: post.beats.items.map(({ image: _, ...b }) => b),
						},
					}) as Effect.Effect<Post>,
			),
		);
		const mj = join(ctx.paths.data, "mj.png");
		mkdirSync(ctx.paths.data, { recursive: true });
		writeFileSync(mj, "png");
		await Effect.runPromise(imageImport.run({ post: SLUG, beat: 0, file: mj }, ctx, MODE));
		// WHEN images are generated
		await Effect.runPromise(
			imageGenerate.run(
				{ post: SLUG, beat: undefined, reroll: false, model: undefined },
				ctx,
				MODE,
			),
		);
		// THEN only beat 1 went to FAL, and beat 0 keeps the imported file
		expect(fake.submits.map((s) => s.prompt)).toEqual(["a sky"]);
		const post = await Effect.runPromise(readPost(ctx, SLUG));
		expect(post.beats?.items[0]?.image?.source).toBe("imported");
	});
});

describe("adopting an old download folder", () => {
	it("should copy it into saved collections and refuse to overwrite one", async () => {
		// GIVEN an ig-saved.sh folder with a URL list and a transcript
		ctx = makeTestContext();
		const old = join(ctx.paths.data, "old");
		mkdirSync(join(old, "transcripts"), { recursive: true });
		writeFileSync(join(old, "urls.txt"), "https://www.instagram.com/p/x/\n");
		writeFileSync(join(old, "transcripts", "x.txt"), "hello\n");
		// WHEN it's adopted twice under the same name
		const first = await Effect.runPromise(
			sourceAdopt.run({ from: old, collection: "sm-awareness" }, ctx, MODE),
		);
		const second = errorOf(
			await Effect.runPromiseExit(
				sourceAdopt.run({ from: old, collection: "sm-awareness" }, ctx, MODE),
			),
		);
		// THEN the first copies its files and the second is refused
		expect(first.transcripts).toBe(1);
		expect(second?.code).toBe("conflict");
		expect(postDir(ctx, SLUG)).toContain("mine");
	});
});
