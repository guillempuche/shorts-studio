import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { stageOf } from "@shorts-studio/domain/post";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { Context } from "../context.ts";
import { postDir, readPost } from "../post-store.ts";
import { testContext } from "../test/context.ts";
import { fakeMediaTools, fakePorts, run, runFailure } from "../test/fakes.ts";
import { seedPost, withDraft } from "../test/posts.ts";
import { postArchive, postFinalize, postPublish, postReview } from "./lifecycle.ts";

const SLUG = "2026-11-05-life";
const MODE = { dryRun: false, confirmed: true } as const;

const review = (
	ctx: Context,
	decision: "approve" | "fix" | "reject",
	extra: { readonly beatNotes?: string; readonly animate?: string } = {},
) =>
	postReview.run(
		{ post: SLUG, decision, note: undefined, beatNotes: extra.beatNotes, animate: extra.animate },
		ctx,
		MODE,
	);

const postOf = (ctx: Context) => Effect.runPromise(readPost(ctx, SLUG));

/** The finished video, exported from CapCut outside the posts folder. */
const finishedVideo = (ctx: Context): string => {
	mkdirSync(ctx.paths.data, { recursive: true });
	const file = join(ctx.paths.data, "export.mp4");
	writeFileSync(file, "final cut");
	return file;
};

describe("post review", () => {
	it("should record nothing when no one is at a terminal, since the decision is the user's", async () => {
		// GIVEN a post with a draft, and a command run from an agent's shell, which has no terminal
		const ctx = testContext({ interactive: false });
		await seedPost(ctx, SLUG, withDraft());

		// WHEN the draft is approved
		const error = await runFailure(review(ctx, "approve"));

		// THEN no review is recorded, and the user is asked to run it themselves
		expect(error.code).toBe("needs-confirmation");
		expect(error.fix).toContain("terminal");
		expect((await postOf(ctx)).review).toBeUndefined();
	});

	it("should move an approved draft to approved, keeping notes and beats to animate", async () => {
		// GIVEN a post with a draft
		const ctx = testContext();
		await seedPost(ctx, SLUG, withDraft());

		// WHEN the user approves it, with a note on beat 0 and beat 1 marked for animation
		const result = await run(review(ctx, "approve", { beatNotes: "0:warmer light", animate: "1" }));

		// THEN the post is approved
		expect(result.stage).toBe("approved");
		// AND the review keeps the notes for the draft it was made on
		const saved = (await postOf(ctx)).review;
		expect(saved?.draftHash).toBe("d1");
		expect(saved?.beatNotes).toEqual([{ beat: 0, note: "warmer light" }]);
		expect(saved?.animate).toEqual([1]);
	});

	it("should refuse notes for a beat that doesn't exist", async () => {
		// GIVEN a post with beats 0 and 1
		const ctx = testContext();
		await seedPost(ctx, SLUG, withDraft());

		// WHEN a note names beat 7
		const error = await runFailure(review(ctx, "fix", { beatNotes: "7:too dark" }));

		// THEN it is a usage error
		expect(error.code).toBe("usage");
		// AND nothing is recorded
		expect((await postOf(ctx)).review).toBeUndefined();
	});

	it("should refuse beat notes it can't read", async () => {
		// GIVEN a post with a draft
		const ctx = testContext();
		await seedPost(ctx, SLUG, withDraft());

		// WHEN a note has no beat number
		const error = await runFailure(review(ctx, "fix", { beatNotes: "too dark" }));

		// THEN it is a usage error that shows the expected form
		expect(error.code).toBe("usage");
		expect(error.fix).toContain("3:too dark;5:wrong face");
	});

	it("should refuse to review a post that has no draft yet", async () => {
		// GIVEN a post with no draft
		const ctx = testContext();
		await seedPost(ctx, SLUG);

		// WHEN it is reviewed
		const error = await runFailure(review(ctx, "approve"));

		// THEN there is nothing to review
		expect(error.code).toBe("not-found");
	});
});

describe("post finalize", () => {
	it("should refuse to finalize a draft the user hasn't approved", async () => {
		// GIVEN a draft marked for fixing, and a finished video
		const ctx = testContext();
		await seedPost(ctx, SLUG, withDraft());
		await run(review(ctx, "fix"));
		const video = finishedVideo(ctx);

		// WHEN it is finalized
		const error = await runFailure(postFinalize.run({ post: SLUG, file: video }, ctx, MODE));

		// THEN it waits for the user's approval
		expect(error.code).toBe("needs-confirmation");
		expect((await postOf(ctx)).final).toBeUndefined();
	});

	it("should save the finished video as the post's final once the draft is approved", async () => {
		// GIVEN an approved draft and a 58-second finished video
		const ctx = testContext();
		await seedPost(ctx, SLUG, withDraft());
		await run(review(ctx, "approve"));
		const video = finishedVideo(ctx);

		// WHEN it is finalized
		const result = await run(
			postFinalize.run({ post: SLUG, file: video }, ctx, MODE),
			fakePorts({ mediaTools: fakeMediaTools({ durationSec: 58 }) }),
		);

		// THEN a copy is saved as final.mp4 with its length
		expect(result.file).toBe(join(postDir(ctx, SLUG), "final.mp4"));
		expect(result.durationSec).toBe(58);
		expect(readFileSync(result.file, "utf8")).toBe("final cut");
		// AND the post moves to final
		expect(stageOf(await postOf(ctx))).toBe("final");
	});
});

describe("post publish", () => {
	it("should keep one record per platform", async () => {
		// GIVEN a post published on Instagram
		const ctx = testContext();
		await seedPost(ctx, SLUG, withDraft());
		const publish = (platform: "instagram" | "tiktok", url: string) =>
			run(postPublish.run({ post: SLUG, platform, url }, ctx, MODE));
		await publish("instagram", "https://instagram.com/p/old");

		// WHEN the Instagram URL is recorded again, then a TikTok one
		await publish("instagram", "https://instagram.com/p/new");
		const result = await publish("tiktok", "https://tiktok.com/@me/video/1");

		// THEN there is one record for each platform, with Instagram's latest URL
		expect(result.platforms).toEqual(["instagram", "tiktok"]);
		const published = (await postOf(ctx)).published;
		expect(published?.find((p) => p.platform === "instagram")?.url).toBe(
			"https://instagram.com/p/new",
		);
	});

	it("should refuse an address that isn't a web URL", async () => {
		// GIVEN a post
		const ctx = testContext();
		await seedPost(ctx, SLUG, withDraft());

		// WHEN a publish is recorded without https://
		const error = await runFailure(
			postPublish.run({ post: SLUG, platform: "instagram", url: "instagram.com/p/x" }, ctx, MODE),
		);

		// THEN it is a usage error and nothing is recorded
		expect(error.code).toBe("usage");
		expect((await postOf(ctx)).published).toBeUndefined();
	});
});

describe("post archive", () => {
	it("should move the post to archived and keep what was recorded", async () => {
		// GIVEN a published post
		const ctx = testContext();
		await seedPost(ctx, SLUG, withDraft());
		await run(
			postPublish.run({ post: SLUG, platform: "youtube", url: "https://youtu.be/x" }, ctx, MODE),
		);

		// WHEN it is archived
		await run(postArchive.run({ post: SLUG }, ctx, MODE));

		// THEN its stage is archived
		const post = await postOf(ctx);
		expect(stageOf(post)).toBe("archived");
		// AND what was recorded stays
		expect(post.published).toHaveLength(1);
	});
});
