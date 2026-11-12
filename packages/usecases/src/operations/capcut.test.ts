import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { Context } from "../context.ts";
import { postDir, updatePost } from "../post-store.ts";
import { testContext } from "../test/context.ts";
import { fakeMediaTools, fakePorts, run, runFailure } from "../test/fakes.ts";
import { seedPost, withDraft } from "../test/posts.ts";
import { capcutExport } from "./capcut.ts";
import { draftInputHash } from "./draft.ts";
import { postReview } from "./lifecycle.ts";

const SLUG = "2026-11-05-capcut";
const MODE = { dryRun: false, confirmed: true } as const;

/** A post whose draft the user decided on, with the audio and captions the render left. */
const reviewed = async (
	ctx: Context,
	decision: "approve" | "fix",
	origin: "mine" | "others" = "mine",
) => {
	const fields = withDraft();
	await seedPost(ctx, SLUG, {
		...fields,
		...(fields.audio && { audio: { ...fields.audio, origin } }),
	});
	// The draft was rendered from the beats as they are, as draft render records it.
	await Effect.runPromise(
		updatePost(ctx, SLUG, "test", (post) =>
			Effect.succeed({
				...post,
				...(post.draft && {
					draft: {
						...post.draft,
						inputHash: draftInputHash(ctx, post, fakeMediaTools().rendererVersion),
					},
				}),
			}),
		),
	);
	const dir = postDir(ctx, SLUG);
	mkdirSync(join(dir, "audio"), { recursive: true });
	writeFileSync(join(dir, "audio", "audio.m4a"), "voice");
	writeFileSync(join(dir, "captions.srt"), "1\n00:00:00,000 --> 00:00:01,000\nHello\n");
	await run(
		postReview.run(
			{ post: SLUG, decision, note: undefined, beatNotes: undefined, animate: undefined },
			ctx,
			MODE,
		),
	);
	return dir;
};

describe("capcut export", () => {
	it("should refuse to export a draft the user hasn't approved", async () => {
		// GIVEN a draft marked for fixing
		const ctx = testContext();
		const dir = await reviewed(ctx, "fix");

		// WHEN it is exported
		const error = await runFailure(capcutExport.run({ post: SLUG, mute: false }, ctx, MODE));

		// THEN it waits for the user's approval
		expect(error.code).toBe("needs-approval");
		expect(existsSync(join(dir, "capcut"))).toBe(false);
	});

	it("should export one clip per beat, the audio, the captions and a clean draft", async () => {
		// GIVEN an approved draft of two 2-second beats with your own audio
		const ctx = testContext();
		const dir = await reviewed(ctx, "approve");
		const media = fakeMediaTools();

		// WHEN it is exported
		const result = await run(
			capcutExport.run({ post: SLUG, mute: false }, ctx, MODE),
			fakePorts({ mediaTools: media }),
		);

		// THEN each beat becomes a silent clip from 0 with the beat's length, in order
		const out = join(dir, "capcut");
		const clips = media.renders.filter((job) => job.output.includes("clips"));
		expect(clips.map((job) => job.output)).toEqual([
			join("capcut", "clips", "01-beat-00.mp4"),
			join("capcut", "clips", "02-beat-01.mp4"),
		]);
		for (const job of clips) {
			expect(job.beats).toEqual([expect.objectContaining({ start: 0, end: 2 })]);
			expect(job.audio).toBeUndefined();
			expect(job.captions).toBeUndefined();
		}
		// AND the clean draft has the audio and no captions
		const clean = media.renders.find((job) => job.output.endsWith("draft-clean.mp4"));
		expect(clean?.audio).toBe("audio/audio.m4a");
		expect(clean?.captions).toBeUndefined();
		// AND the audio, captions and steps sit beside the clips
		expect(readFileSync(join(out, "audio.m4a"), "utf8")).toBe("voice");
		expect(readFileSync(join(out, "captions.srt"), "utf8")).toContain("Hello");
		expect(readFileSync(join(out, "README.txt"), "utf8")).toContain("Import audio.m4a");
		expect(result).toMatchObject({ dir: out, clips: 2, muted: false });
	});

	it("should leave out audio from someone else's reel", async () => {
		// GIVEN an approved draft over audio from someone else's reel
		const ctx = testContext();
		const dir = await reviewed(ctx, "approve", "others");
		const media = fakeMediaTools();

		// WHEN it is exported
		const result = await run(
			capcutExport.run({ post: SLUG, mute: false }, ctx, MODE),
			fakePorts({ mediaTools: media }),
		);

		// THEN no video carries the audio and no audio file is written
		expect(result.muted).toBe(true);
		expect(media.renders.every((job) => job.audio === undefined)).toBe(true);
		expect(existsSync(join(dir, "capcut", "audio.m4a"))).toBe(false);
		// AND the steps say to use the platform's sound
		expect(readFileSync(join(dir, "capcut", "README.txt"), "utf8")).toContain("in-app sound");
	});

	it("should refuse a draft whose beats changed after it was approved", async () => {
		// GIVEN an approved draft, whose beat 1 got a new story moment afterwards
		const ctx = testContext();
		const dir = await reviewed(ctx, "approve");
		await Effect.runPromise(
			updatePost(ctx, SLUG, "test", (post) =>
				Effect.succeed({
					...post,
					...(post.beats && {
						beats: {
							...post.beats,
							items: post.beats.items.map((b) => (b.index === 1 ? { ...b, moment: "twist" } : b)),
						},
					}),
				}),
			),
		);

		// WHEN it is exported
		const error = await runFailure(capcutExport.run({ post: SLUG, mute: false }, ctx, MODE));

		// THEN nothing is exported, and the fix renders the draft again for a new review
		expect(error.code).toBe("stale");
		expect(error.fix).toContain("draft render");
		expect(existsSync(join(dir, "capcut"))).toBe(false);
	});
});
