/**
 * `image import`: put your own image (from Midjourney, a photo) on a beat. `image generate`
 * leaves imported images alone unless the beat is rerolled. It refuses a beat whose request is
 * paid for and not fetched, and waits while `image generate` runs on the post.
 */

import { closeSync, copyFileSync, openSync, readSync } from "node:fs";
import { join } from "node:path";
import { fail } from "@shorts-studio/domain/errors";
import { type Beat, mapBeats } from "@shorts-studio/domain/post";
import { Effect, Schema } from "effect";
import { ensureDir, fileHash, fileStep, hashOf } from "../files.ts";
import { inputFile, RELATIVE_PATH } from "../inputs.ts";
import { defineOperation, p } from "../operation.ts";
import { postDir, readPost, refuseArchived, updatePost } from "../post-store.ts";
import { fetchSavedFix, withImagesLock } from "./image.ts";
import { NextFields, nextOf } from "./post.ts";

/**
 * The image format a file's first bytes show, or undefined for anything else: a name can say
 * `.png` while the file holds text, and the renderer would fail on it only at the draft.
 */
export const imageFormatOf = (head: Uint8Array): ".jpg" | ".png" | ".webp" | undefined => {
	const starts = (bytes: ReadonlyArray<number>, at = 0) =>
		bytes.every((byte, i) => head[at + i] === byte);
	const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0));
	if (starts([0xff, 0xd8, 0xff])) return ".jpg";
	if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return ".png";
	if (starts(ascii("RIFF")) && starts(ascii("WEBP"), 8)) return ".webp";
	return undefined;
};

/** The first 12 bytes of `file`, enough to tell the image formats apart. */
const headOf = (file: string): Uint8Array => {
	const head = new Uint8Array(12);
	const fd = openSync(file, "r");
	try {
		readSync(fd, head, 0, head.length, 0);
	} finally {
		closeSync(fd);
	}
	return head;
};

export const imageImport = defineOperation({
	name: "image_import",
	description:
		"Use your own image (Midjourney, a photo) for one beat. It should be portrait and at least 1344×2400 for the motion to stay sharp. image generate won't replace it unless the beat is rerolled.",
	params: {
		post: p.string("Post slug"),
		beat: p.int("Beat index"),
		file: p.string(`Path to a JPEG, PNG or WebP image; ${RELATIVE_PATH}`),
	},
	output: Schema.Struct({ file: Schema.String, ...NextFields }),
	surface: "cli-and-mcp",
	spends: false,
	hints: { readonly: false, destructive: false, idempotent: true, openWorld: false },
	run: Effect.fn("image_import")(function* (input, ctx) {
		const source = yield* inputFile(input.file, "Check the path and try again.");
		const format = imageFormatOf(
			yield* fileStep(() => headOf(source), `Check that ${source} is readable, then run it again.`),
		);
		if (format === undefined) {
			return yield* fail(
				"usage",
				`${source} isn't a JPEG, PNG or WebP image, whatever its name says.`,
				"Export the image as JPEG, PNG or WebP.",
			);
		}
		// Read first outside the lock: a post that isn't there has no folder to lock.
		yield* refuseArchived(yield* readPost(ctx, input.post), "image import");
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
					const fetch = fetchSavedFix(ctx, input.post, [beat]);
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
					// Named by what it holds, so a PNG called .jpg is saved as .png.
					`beat-${String(input.beat).padStart(2, "0")}-imported${format}`,
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
		return { file: imported.file, ...(yield* nextOf(ctx, imported.post)) };
	}),
	render: (o) => `Imported ${o.file}\nNext: ${o.next}`,
});
