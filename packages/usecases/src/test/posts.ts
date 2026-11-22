/** Posts seeded at a given stage, as if the commands that record each step had already run. */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { approvalOf, mapBeats, type Post } from "@shorts-studio/domain/post";
import { Effect } from "effect";
import type { Context } from "../context.ts";
import { draftInputHash, planInputHash } from "../freshness.ts";
import { createPost, postDir, updatePost } from "../post-store.ts";
import { NOW } from "./context.ts";
import { fakeMediaTools } from "./fakes.ts";

export type PostFields = Partial<Omit<Post, "slug" | "manifestVersion" | "revision">>;

/** Creates a post with these fields, as if the commands that record them had already run. */
export const seedPost = (ctx: Context, slug: string, fields: PostFields = {}): Promise<Post> =>
	Effect.runPromise(
		createPost(ctx, { slug, createdAt: NOW.toISOString() }).pipe(
			Effect.andThen(
				updatePost(ctx, slug, "test", (post) => Effect.succeed({ ...post, ...fields })),
			),
		),
	);

/** These fields with the script approved as they stand, as `script approve` records it. */
export const approvedAsIs = (fields: PostFields): PostFields => {
	// Blank required fields, since `approvalOf` reads only the script, audio and beats.
	const post: Post = { manifestVersion: 1, slug: "", createdAt: "", revision: 1, ...fields };
	return post.script === undefined
		? fields
		: { ...fields, script: { ...post.script, ...approvalOf(post) } };
};

/** Approves the post as it now stands, as `script approve` records it. */
export const approveAsIs = (ctx: Context, slug: string): Promise<Post> =>
	Effect.runPromise(
		updatePost(ctx, slug, "test", (post) =>
			Effect.succeed(
				post.script === undefined
					? post
					: { ...post, script: { ...post.script, ...approvalOf(post) } },
			),
		),
	);

/** An approved script and two beats with prompts and no images: ready for `image generate`. */
export const readyForImages = (): PostFields =>
	approvedAsIs({
		script: { file: "script.md", hash: "s" },
		beats: {
			inputHash: "b",
			items: [
				{ index: 0, start: 0, end: 2, text: "one", prompt: "a red door" },
				{ index: 1, start: 2, end: 4, text: "two", prompt: "a blue sky" },
			],
		},
	});

const generatedImage = (index: number) => ({
	file: `images/beat-0${index}.jpg`,
	hash: `i${index}`,
	inputHash: `h${index}`,
	provider: "fake-images",
	model: "fake-fast",
	seed: 1,
	source: "generated" as const,
});

/** Your own speech audio, its transcript, two beats with images and a draft waiting for review. */
export const withDraft = (draftHash = "d1"): PostFields =>
	approvedAsIs({
		script: { file: "script.md", hash: "s" },
		audio: {
			file: "audio/audio.m4a",
			hash: "a",
			origin: "mine",
			kind: "speech",
			durationSec: 4,
			source: "recording.m4a",
		},
		transcript: {
			file: "transcript.json",
			hash: "t",
			inputHash: "ti",
			provider: "fake-transcriber",
			model: "fake-whisper",
			language: "en",
		},
		beats: {
			inputHash: "b",
			items: [
				{ index: 0, start: 0, end: 2, text: "one", prompt: "a door", image: generatedImage(0) },
				{ index: 1, start: 2, end: 4, text: "two", prompt: "a sky", image: generatedImage(1) },
			],
		},
		draft: {
			file: "draft.mp4",
			hash: draftHash,
			inputHash: "x",
			rendererVersion: 1,
			durationSec: 4,
		},
	});

/** Writes an empty `file` in the post's folder, so it counts as there. */
const placeFile = (ctx: Context, slug: string, file: string) => {
	const path = join(postDir(ctx, slug), file);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, "");
};

/**
 * Creates a post with these fields whose every output counts as up to date: each records what it
 * was made from, as the commands that make them would, and each image's and the draft's file is
 * there. A review in `fields` keeps counting: the draft's hash stays.
 */
export const seedUpToDate = async (
	ctx: Context,
	slug: string,
	fields: PostFields = {},
): Promise<Post> => {
	await seedPost(ctx, slug, fields);
	return Effect.runPromise(
		updatePost(ctx, slug, "test", (post) => {
			const transcript =
				post.transcript === undefined || post.audio === undefined
					? post.transcript
					: { ...post.transcript, audioHash: post.audio.hash };

			// Each image records its beat's prompt, and the beat keeps the seed it was made with.
			const withImages = mapBeats({ ...post, ...(transcript && { transcript }) }, (beat) =>
				beat.image === undefined
					? beat
					: {
							...beat,
							seed: beat.image.seed,
							image: {
								...beat.image,
								...(beat.prompt === undefined ? {} : { prompt: beat.prompt }),
							},
						},
			);

			const sourceHash = planInputHash(withImages);
			const planned =
				withImages.beats === undefined || sourceHash === undefined
					? withImages
					: { ...withImages, beats: { ...withImages.beats, sourceHash } };

			for (const beat of planned.beats?.items ?? []) {
				if (beat.image !== undefined) placeFile(ctx, slug, beat.image.file);
			}

			if (planned.draft === undefined) return Effect.succeed(planned);
			placeFile(ctx, slug, planned.draft.file);
			const inputHash = draftInputHash(ctx, planned, fakeMediaTools().rendererVersion);
			return Effect.succeed({ ...planned, draft: { ...planned.draft, inputHash } });
		}),
	);
};
