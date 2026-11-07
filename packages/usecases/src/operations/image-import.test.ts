import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { Context } from "../context.ts";
import { postDir, readPost } from "../post-store.ts";
import { testContext } from "../test/context.ts";
import { run, runFailure } from "../test/fakes.ts";
import { readyForImages, seedPost } from "../test/posts.ts";
import { imageImport } from "./image-import.ts";

const SLUG = "2026-11-04-import";
const MODE = { dryRun: false, confirmed: true } as const;

/** A file the user made elsewhere, outside the posts folder. */
const ownImage = (ctx: Context, name: string): string => {
	mkdirSync(ctx.paths.data, { recursive: true });
	const file = join(ctx.paths.data, name);
	writeFileSync(file, "my picture");
	return file;
};

describe("image import", () => {
	it("should copy the image into the post and mark the beat's image as imported", async () => {
		// GIVEN a post with two beats and a PNG made in Midjourney
		const ctx = testContext();
		await seedPost(ctx, SLUG, readyForImages());
		const png = ownImage(ctx, "Midjourney.PNG");

		// WHEN it is imported for beat 1
		const result = await run(imageImport.run({ post: SLUG, beat: 1, file: png }, ctx, MODE));

		// THEN a copy sits in the post's images folder
		const copy = join(postDir(ctx, SLUG), "images", "beat-01-imported.png");
		expect(result.file).toBe(copy);
		expect(readFileSync(copy, "utf8")).toBe("my picture");
		// AND beat 1 records it as imported, while beat 0 is untouched
		const beats = (await Effect.runPromise(readPost(ctx, SLUG))).beats?.items;
		expect(beats?.[1]?.image).toMatchObject({
			file: "images/beat-01-imported.png",
			source: "imported",
		});
		expect(beats?.[0]?.image).toBeUndefined();
	});

	it("should refuse a file that isn't a JPEG, PNG or WebP image", async () => {
		// GIVEN a post and a GIF
		const ctx = testContext();
		await seedPost(ctx, SLUG, readyForImages());
		const gif = ownImage(ctx, "loop.gif");

		// WHEN it is imported
		const error = await runFailure(imageImport.run({ post: SLUG, beat: 0, file: gif }, ctx, MODE));

		// THEN it is a usage error and nothing is copied
		expect(error.code).toBe("usage");
		expect(existsSync(join(postDir(ctx, SLUG), "images"))).toBe(false);
	});

	it("should refuse a beat the plan doesn't have", async () => {
		// GIVEN a post with beats 0 and 1
		const ctx = testContext();
		await seedPost(ctx, SLUG, readyForImages());
		const png = ownImage(ctx, "extra.png");

		// WHEN an image is imported for beat 7
		const error = await runFailure(imageImport.run({ post: SLUG, beat: 7, file: png }, ctx, MODE));

		// THEN it is a usage error that says how to see the beats
		expect(error.code).toBe("usage");
		expect(error.fix).toContain(`post show --post ${SLUG}`);
	});

	it("should say so when the file doesn't exist", async () => {
		// GIVEN a post
		const ctx = testContext();
		await seedPost(ctx, SLUG, readyForImages());

		// WHEN a missing file is imported
		const error = await runFailure(
			imageImport.run({ post: SLUG, beat: 0, file: join(ctx.paths.data, "gone.png") }, ctx, MODE),
		);

		// THEN it is not found
		expect(error.code).toBe("not-found");
	});
});
