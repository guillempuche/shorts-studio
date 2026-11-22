import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { Context } from "../context.ts";
import { postDir, readPost } from "../post-store.ts";
import { testContext } from "../test/context.ts";
import { fakePng, fakePorts, run, runFailure } from "../test/fakes.ts";
import { failurePastLockWait } from "../test/lock.ts";
import { readyForImages, seedPost } from "../test/posts.ts";
import { imageImport } from "./image-import.ts";

const SLUG = "2026-11-04-import";
const MODE = { dryRun: false, confirmed: true } as const;

/** Beat 1's image request, sent and paid for, as `image generate` saves it before fetching. */
const SAVED_REQUEST = {
	provider: "fake-images",
	model: "fake-fast",
	requestId: "req-1",
	statusUrl: "memory://req-1/status",
	responseUrl: "memory://req-1",
	inputHash: "h1",
	seed: 1,
	ledgerId: "l1",
};

/** A post ready for images, with beat 1's request saved and not fetched yet. */
const withSavedRequest = () => {
	const ready = readyForImages();
	return {
		...ready,
		...(ready.beats && {
			beats: {
				...ready.beats,
				items: ready.beats.items.map((b) => (b.index === 1 ? { ...b, pending: SAVED_REQUEST } : b)),
			},
		}),
	};
};

/** A file the user made elsewhere, outside the posts folder: a PNG unless `bytes` says otherwise. */
const ownImage = (
	ctx: Context,
	name: string,
	bytes: Uint8Array | string = fakePng("my picture"),
): string => {
	mkdirSync(ctx.paths.data, { recursive: true });
	const file = join(ctx.paths.data, name);
	writeFileSync(file, bytes);
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
		expect(readFileSync(copy)).toEqual(Buffer.from(fakePng("my picture")));
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
		const gif = ownImage(ctx, "loop.gif", "GIF89a…");

		// WHEN it is imported
		const error = await runFailure(imageImport.run({ post: SLUG, beat: 0, file: gif }, ctx, MODE));

		// THEN it is a usage error and nothing is copied
		expect(error.code).toBe("usage");
		expect(existsSync(join(postDir(ctx, SLUG), "images"))).toBe(false);
	});

	it("should refuse text named as a PNG, keeping the beat's image", async () => {
		// GIVEN a post whose beat 0 has an image, and notes saved as notes.png
		const ctx = testContext();
		await seedPost(ctx, SLUG, readyForImages());
		await run(
			imageImport.run({ post: SLUG, beat: 0, file: ownImage(ctx, "first.png") }, ctx, MODE),
		);
		const before = (await Effect.runPromise(readPost(ctx, SLUG))).beats?.items[0]?.image;
		const notes = ownImage(ctx, "notes.png", "just some notes");

		// WHEN the notes are imported for beat 0
		const error = await runFailure(
			imageImport.run({ post: SLUG, beat: 0, file: notes }, ctx, MODE),
		);

		// THEN it is a usage error, and beat 0 keeps the image it had
		expect(error.code).toBe("usage");
		expect(error.message).toContain(notes);
		expect((await Effect.runPromise(readPost(ctx, SLUG))).beats?.items[0]?.image).toEqual(before);
	});

	it("should name the copy by what the file holds", async () => {
		// GIVEN a PNG saved with a .jpg name
		const ctx = testContext();
		await seedPost(ctx, SLUG, readyForImages());
		const png = ownImage(ctx, "photo.jpg");

		// WHEN it is imported for beat 1
		const result = await run(imageImport.run({ post: SLUG, beat: 1, file: png }, ctx, MODE));

		// THEN the copy is a .png
		expect(result.file).toBe(join(postDir(ctx, SLUG), "images", "beat-01-imported.png"));
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

	it("should refuse a beat whose request is paid for and not fetched, keeping the request", async () => {
		// GIVEN beat 1's image request sent and saved, and not fetched yet
		const ctx = testContext();
		await seedPost(ctx, SLUG, withSavedRequest());
		const png = ownImage(ctx, "mine.png");

		// WHEN an image is imported for beat 1
		const error = await runFailure(imageImport.run({ post: SLUG, beat: 1, file: png }, ctx, MODE));

		// THEN it fails with conflict, and nothing is copied
		expect(error.code).toBe("conflict");
		expect(existsSync(join(postDir(ctx, SLUG), "images"))).toBe(false);
		// AND beat 1's saved request is still there
		const beat = (await Effect.runPromise(readPost(ctx, SLUG))).beats?.items[1];
		expect(beat?.pending).toEqual(SAVED_REQUEST);
		expect(beat?.image).toBeUndefined();
		// AND the fix names fetching it first, with the model that sent it, and since the request
		// was made for another input ("h1"), that the same run pays for a new image
		expect(error.fix).toContain(
			`Run image generate --post ${SLUG} --beat 1 --model fake-fast first: it fetches the image already paid for, and pays for a new one for beat 1, changed since its request`,
		);
	});

	it("should refuse while image generate runs on the post", async () => {
		// GIVEN a post whose images a running image generate holds
		const ctx = testContext();
		await seedPost(ctx, SLUG, readyForImages());
		const lockFile = join(postDir(ctx, SLUG), "images.lock");
		// Taken now, not at the test clock's date: a lock from before the machine started is stale.
		writeFileSync(
			lockFile,
			JSON.stringify({
				pid: process.pid,
				command: "image generate",
				since: new Date().toISOString(),
			}),
		);
		const png = ownImage(ctx, "mine.png");

		// WHEN an image is imported, and the lock stays busy past the wait
		const error = await failurePastLockWait(
			imageImport
				.run({ post: SLUG, beat: 0, file: png }, ctx, MODE)
				.pipe(Effect.provide(fakePorts())),
		);

		// THEN it fails with conflict, naming image generate and its lock file
		expect(error.code).toBe("conflict");
		expect(error.message).toContain('"image generate"');
		expect(error.message).toContain(lockFile);
		// AND beat 0 has no image
		expect((await Effect.runPromise(readPost(ctx, SLUG))).beats?.items[0]?.image).toBeUndefined();
	});
});
