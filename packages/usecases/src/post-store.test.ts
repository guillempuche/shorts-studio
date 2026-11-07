import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { createPost, postDir, readPost, updatePost } from "./post-store.ts";
import { testContext } from "./test/context.ts";
import { seedPost } from "./test/posts.ts";

const SLUG = "2026-11-04-store";

describe("updatePost", () => {
	it("should add one to the revision on every update", async () => {
		// GIVEN a new post, at revision 1
		const ctx = testContext();
		await Effect.runPromise(createPost(ctx, { slug: SLUG, createdAt: "x" }));

		// WHEN it is updated twice
		await Effect.runPromise(
			updatePost(ctx, SLUG, "test", (p) => Effect.succeed({ ...p, aiGenerated: true })),
		);
		const post = await Effect.runPromise(updatePost(ctx, SLUG, "test", (p) => Effect.succeed(p)));

		// THEN its revision counts the writes
		expect(post.revision).toBe(3);
		// AND the file holds the latest change
		expect((await Effect.runPromise(readPost(ctx, SLUG))).aiGenerated).toBe(true);
	});
});

describe("readPost", () => {
	it("should name every invalid field of a hand-edited post.json", async () => {
		// GIVEN a post.json edited by hand with two wrong fields
		const ctx = testContext();
		await seedPost(ctx, SLUG);
		writeFileSync(
			join(postDir(ctx, SLUG), "post.json"),
			JSON.stringify({ manifestVersion: 1, slug: 5, createdAt: "x", revision: "two" }),
		);

		// WHEN it is read
		const error = await Effect.runPromise(Effect.flip(readPost(ctx, SLUG)));

		// THEN the error points at both fields
		expect(error.message).toContain('["slug"]');
		expect(error.message).toContain('["revision"]');
		// AND says how to recover
		expect(error.fix).toContain("hand edit");
	});

	it("should refuse a slug that isn't lowercase words and dashes", async () => {
		// GIVEN a context
		const ctx = testContext();

		// WHEN a post with spaces in its slug is read
		const error = await Effect.runPromise(Effect.flip(readPost(ctx, "My Post")));

		// THEN it is a usage error
		expect(error.code).toBe("usage");
	});

	it("should say how to list posts when the post doesn't exist", async () => {
		// GIVEN no posts
		const ctx = testContext();

		// WHEN a post is read
		const error = await Effect.runPromise(Effect.flip(readPost(ctx, SLUG)));

		// THEN it is not found, and the fix lists the posts
		expect(error.code).toBe("not-found");
		expect(error.fix).toContain("post list");
	});
});

describe("createPost", () => {
	it("should refuse to replace a post that already exists", async () => {
		// GIVEN a post with a title
		const ctx = testContext();
		await seedPost(ctx, SLUG, { brief: { title: "Kept" } });

		// WHEN a post with the same slug is created
		const error = await Effect.runPromise(
			Effect.flip(createPost(ctx, { slug: SLUG, createdAt: "y" })),
		);

		// THEN it is a conflict
		expect(error.code).toBe("conflict");
		// AND the first post is untouched
		expect((await Effect.runPromise(readPost(ctx, SLUG))).brief?.title).toBe("Kept");
	});
});
