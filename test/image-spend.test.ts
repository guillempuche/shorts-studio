import { Effect, Exit, Fiber } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { ShortsError } from "../src/core/errors.ts";
import { readLedger, spent } from "../src/core/ledger.ts";
import { createPost, readPost, updatePost } from "../src/core/post-store.ts";
import type { Post } from "../src/domain/post.ts";
import { imageGenerate } from "../src/operations/image.ts";
import { makeTestContext, type TestContext } from "./support/context.ts";
import { type FakeFal, type FakeFalOptions, startFakeFal } from "./support/fake-fal.ts";

const SLUG = "2026-11-04-spend";
let ctx: TestContext;
let fake: FakeFal;
afterEach(async () => {
	await fake?.close();
	ctx?.cleanup();
});

/** A post ready for images: approved script, two beats with prompts. */
const readyPost = async (options: FakeFalOptions = {}) => {
	fake = await startFakeFal(options);
	ctx = makeTestContext({
		endpoints: { fal: fake.url, together: "http://127.0.0.1:1" },
		secrets: { FAL_KEY: "test" },
	});
	await Effect.runPromise(createPost(ctx, { slug: SLUG, createdAt: "x" }));
	await Effect.runPromise(
		updatePost(
			ctx,
			SLUG,
			"test",
			(post): Effect.Effect<Post> =>
				Effect.succeed({
					...post,
					script: { file: "script.md", hash: "h", approvedHash: "h" },
					beats: {
						inputHash: "b",
						items: [
							{ index: 0, start: 0, end: 2, text: "one", prompt: "a red door" },
							{ index: 1, start: 2, end: 4, text: "two", prompt: "a blue sky" },
						],
					},
				}),
		),
	);
};

const generate = (input: Partial<{ beat: string; reroll: boolean }> = {}, dryRun = false) =>
	imageGenerate.run(
		{ post: SLUG, beat: input.beat, reroll: input.reroll ?? false, model: undefined },
		ctx,
		{ dryRun, confirmed: true },
	);

describe("image generate", () => {
	it("should pay once per beat and nothing on a re-run", async () => {
		// GIVEN a post ready for images
		await readyPost();
		// WHEN images are generated twice
		await Effect.runPromise(generate());
		await Effect.runPromise(generate());
		// THEN FAL saw one request per beat, and every beat has an image
		expect(fake.submits).toHaveLength(2);
		const post = await Effect.runPromise(readPost(ctx, SLUG));
		expect(post.beats?.items.every((b) => b.image !== undefined)).toBe(true);
	});

	it("should spend nothing on a dry run", async () => {
		// GIVEN a post ready for images
		await readyPost();
		// WHEN a dry run is asked for
		const result = await Effect.runPromise(generate({}, true));
		// THEN it plans two images with a cost, and nothing reaches FAL or the ledger
		expect(result.planned.filter((p) => p.action === "generate")).toHaveLength(2);
		expect(result.estimateUsd).toBeGreaterThan(0);
		expect(fake.submits).toHaveLength(0);
		expect(readLedger(ctx)).toHaveLength(0);
	});

	it("should resume a request cut short instead of paying for it again", async () => {
		// GIVEN a post ready for images, and a FAL that never finishes
		const options: FakeFalOptions = { pollsBeforeDone: 1_000_000 };
		await readyPost(options);
		// WHEN the run is interrupted once beat 0 was submitted
		const fiber = Effect.runFork(generate({ beat: "0" }));
		while (fake.submits.length === 0) await new Promise((r) => setTimeout(r, 20));
		await new Promise((r) => setTimeout(r, 100));
		await Effect.runPromise(Fiber.interrupt(fiber));
		const pending = (await Effect.runPromise(readPost(ctx, SLUG))).beats?.items[0]?.pending;
		// AND it runs again once FAL is done
		options.pollsBeforeDone = 0;
		await Effect.runPromise(generate({ beat: "0" }));
		// THEN the request was saved, resumed, and paid for once
		expect(pending?.requestId).toBe("req-1");
		expect(fake.submits).toHaveLength(1);
		const post = await Effect.runPromise(readPost(ctx, SLUG));
		expect(post.beats?.items[0]?.image).toBeDefined();
		expect(post.beats?.items[0]?.pending).toBeUndefined();
		expect(readLedger(ctx).filter((e) => e.type === "reserve")).toHaveLength(1);
	});

	it("should regenerate only the rerolled beat, with a new seed", async () => {
		// GIVEN a post whose images exist
		await readyPost();
		await Effect.runPromise(generate());
		const before = (await Effect.runPromise(readPost(ctx, SLUG))).beats?.items[1]?.seed;
		// WHEN beat 1 is rerolled
		await Effect.runPromise(generate({ beat: "1", reroll: true }));
		// THEN one more request was made, for beat 1, with a different seed
		expect(fake.submits).toHaveLength(3);
		expect(fake.submits[2]?.prompt).toBe("a blue sky");
		expect(fake.submits[2]?.seed).not.toBe(before);
	});

	it("should refuse to spend before the script is approved", async () => {
		// GIVEN a post whose script was edited after approval
		await readyPost();
		await Effect.runPromise(
			updatePost(ctx, SLUG, "test", (post) =>
				Effect.succeed({ ...post, script: { file: "script.md", hash: "new", approvedHash: "h" } }),
			),
		);
		// WHEN images are generated
		const exit = await Effect.runPromiseExit(generate());
		// THEN it stops before FAL, asking for the user's approval
		const error = Exit.isFailure(exit) ? Exit.findErrorOption(exit) : undefined;
		expect(error?._tag === "Some" && error.value instanceof ShortsError && error.value.code).toBe(
			"needs-confirmation",
		);
		expect(fake.submits).toHaveLength(0);
	});

	it("should free the reservation when FAL reports the request failed", async () => {
		// GIVEN a FAL whose requests fail
		await readyPost({ finalStatus: "FAILED" });
		// WHEN images are generated
		await Effect.runPromiseExit(generate({ beat: "0" }));
		// THEN nothing counts as spent and no request is left pending
		expect(spent(readLedger(ctx), { day: "2026-11-04" })).toBe(0);
		expect((await Effect.runPromise(readPost(ctx, SLUG))).beats?.items[0]?.pending).toBeUndefined();
	});
});
