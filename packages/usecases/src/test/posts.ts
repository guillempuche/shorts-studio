/** Posts seeded at a given stage, as if the commands that record each step had already run. */

import type { Post } from "@shorts-studio/domain/post";
import { Effect } from "effect";
import type { Context } from "../context.ts";
import { createPost, updatePost } from "../post-store.ts";
import { NOW } from "./context.ts";

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

/** An approved script and two beats with prompts and no images: ready for `image generate`. */
export const readyForImages = (): PostFields => ({
	script: { file: "script.md", hash: "s", approvedHash: "s" },
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

/** Your own speech audio, two beats with images and a rendered draft waiting for review. */
export const withDraft = (draftHash = "d1"): PostFields => ({
	script: { file: "script.md", hash: "s", approvedHash: "s" },
	audio: {
		file: "audio/audio.m4a",
		hash: "a",
		origin: "mine",
		kind: "speech",
		durationSec: 4,
		source: "recording.m4a",
	},
	beats: {
		inputHash: "b",
		items: [
			{ index: 0, start: 0, end: 2, text: "one", prompt: "a door", image: generatedImage(0) },
			{ index: 1, start: 2, end: 4, text: "two", prompt: "a sky", image: generatedImage(1) },
		],
	},
	draft: { file: "draft.mp4", hash: draftHash, inputHash: "x", rendererVersion: 1, durationSec: 4 },
});
