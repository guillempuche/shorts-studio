/**
 * `image import`: put your own image (from Midjourney, a photo) on a beat. `image generate`
 * leaves imported images alone unless the beat is rerolled. It refuses a beat whose request is
 * paid for and not fetched, and waits while `image generate` runs on the post.
 */

import { copyFileSync, existsSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { fail } from "@shorts-studio/domain/errors";
import { type Beat, mapBeats } from "@shorts-studio/domain/post";
import { Effect, Schema } from "effect";
import { ensureDir, fileHash, fileStep, hashOf } from "../files.ts";
import { defineOperation, p } from "../operation.ts";
import { postDir, readPost, updatePost } from "../post-store.ts";
import { freeFetch, withImagesLock } from "./image.ts";
import { NextFields, nextOf } from "./post.ts";

const IMAGE = /^\.(jpe?g|png|webp)$/i;

export const imageImport = defineOperation({
	name: "image_import",
	description:
		"Use your own image (Midjourney, a photo) for one beat. It should be portrait and at least 1344×2400 for the motion to stay sharp. image generate won't replace it unless the beat is rerolled.",
	params: {
		post: p.string("Post slug"),
		beat: p.int("Beat index"),
		file: p.string("Path to a JPEG, PNG or WebP image"),
	},
	output: Schema.Struct({ file: Schema.String, ...NextFields }),
	surface: "cli-and-mcp",
	spends: false,
	hints: { readonly: false, destructive: false, idempotent: true, openWorld: false },
	run: Effect.fn("image_import")(function* (input, ctx) {
		const source = resolve(input.file);
		if (!existsSync(source)) {
			return yield* fail("not-found", `No file at ${source}.`, "Check the path and try again.");
		}
		if (!IMAGE.test(extname(source))) {
			return yield* fail(
				"usage",
				`${source} isn't a JPEG, PNG or WebP image.`,
				"Export the image in one of those formats.",
			);
		}
		// Read first outside the lock: a post that isn't there has no folder to lock.
		yield* readPost(ctx, input.post);
		const imported = yield* withImagesLock(
			ctx,
			input.post,
			"image import",
			Effect.gen(function* () {
				const before = yield* readPost(ctx, input.post);
				const beat = (before.beats?.items ?? []).find((b) => b.index === input.beat);
				if (beat === undefined) {
					return yield* fail(
						"usage",
						`No beat ${input.beat} in ${input.post}.`,
						`See them with: post show --post ${input.post}`,
					);
				}
				// The saved request's image is paid for: replacing it now would lose it.
				if (beat.pending !== undefined) {
					const fetch = freeFetch(input.post, [input.beat]);
					return yield* fail(
						"conflict",
						`Beat ${input.beat} has a request already paid for and not fetched yet, so nothing was imported.`,
						`Run ${fetch.cli} first: it ${fetch.what}. Then import yours.`,
					);
				}
				const dir = postDir(ctx, input.post);
				yield* ensureDir(join(dir, "images"));
				const file = join(
					"images",
					`beat-${String(input.beat).padStart(2, "0")}-imported${extname(source).toLowerCase()}`,
				);
				yield* fileStep(
					() => copyFileSync(source, join(dir, file)),
					`Check that ${source} is readable, then run it again.`,
				);
				const hash = yield* fileHash(join(dir, file));
				const attach = (b: Beat): Beat =>
					b.index !== input.beat
						? b
						: {
								...b,
								image: {
									file,
									hash,
									inputHash: hashOf("imported", hash),
									provider: "import",
									model: "none",
									seed: 0,
									source: "imported",
								},
							};
				const written = yield* updatePost(ctx, input.post, "image import", (current) =>
					Effect.succeed(mapBeats(current, attach)),
				);
				return { post: written, file: join(dir, file) };
			}),
		);
		return { file: imported.file, ...nextOf(imported.post) };
	}),
	render: (o) => `Imported ${o.file}\nNext: ${o.next}`,
});
