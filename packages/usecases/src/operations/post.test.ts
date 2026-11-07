import { describe, expect, it } from "vitest";
import { testContext } from "../test/context.ts";
import { run } from "../test/fakes.ts";
import { seedPost } from "../test/posts.ts";
import { postArchive } from "./lifecycle.ts";
import { postCreate, postList } from "./post.ts";

const MODE = { dryRun: false, confirmed: true } as const;

describe("post create", () => {
	it("should put today's date in front of a slug that has none", async () => {
		// GIVEN today is 2026-11-04
		const ctx = testContext();

		// WHEN a post is created as "morning-routine"
		const created = await run(
			postCreate.run({ post: "morning-routine", title: undefined, notes: undefined }, ctx, MODE),
		);

		// THEN its slug starts with today's date
		expect(created.slug).toBe("2026-11-04-morning-routine");
	});

	it("should keep a slug that already starts with a date", async () => {
		// GIVEN a context
		const ctx = testContext();

		// WHEN a post is created with a dated slug
		const created = await run(
			postCreate.run({ post: "2026-12-01-advent", title: undefined, notes: undefined }, ctx, MODE),
		);

		// THEN the slug is used as given
		expect(created.slug).toBe("2026-12-01-advent");
	});
});

describe("post list", () => {
	it("should list posts newest first, with their stage and title", async () => {
		// GIVEN an older post with a script and a newer one with a title
		const ctx = testContext();
		await seedPost(ctx, "2026-11-03-older", { script: { file: "script.md", hash: "h" } });
		await seedPost(ctx, "2026-11-04-newer", { brief: { title: "Newer" } });

		// WHEN posts are listed
		const { posts } = await run(postList.run({ stage: undefined }, ctx, MODE));

		// THEN the newer comes first, and each shows its stage
		expect(posts).toEqual([
			{ slug: "2026-11-04-newer", stage: "idea", title: "Newer" },
			{ slug: "2026-11-03-older", stage: "script-ready" },
		]);
	});

	it("should hide archived posts unless asked for that stage", async () => {
		// GIVEN one archived post and one in progress
		const ctx = testContext();
		await seedPost(ctx, "2026-11-04-done");
		await seedPost(ctx, "2026-11-04-doing");
		await run(postArchive.run({ post: "2026-11-04-done" }, ctx, MODE));

		// WHEN posts are listed, then listed by stage archived
		const all = await run(postList.run({ stage: undefined }, ctx, MODE));
		const archived = await run(postList.run({ stage: "archived" }, ctx, MODE));

		// THEN the plain list leaves the archived post out
		expect(all.posts.map((p) => p.slug)).toEqual(["2026-11-04-doing"]);
		// AND the archived list shows only it
		expect(archived.posts.map((p) => p.slug)).toEqual(["2026-11-04-done"]);
	});
});
