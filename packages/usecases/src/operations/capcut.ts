/**
 * `capcut export`: everything needed to rebuild the approved draft in CapCut desktop without
 * re-timing a single beat.
 *
 * CapCut has no import format for a whole timeline, and its project files are an unofficial
 * format that breaks between versions. So the hand-off is plain media: one clip per beat, in
 * order, with its motion already applied; the audio; the captions as SRT; and a clean draft to
 * line the clips up against. CapCut desktop imports SRT; the mobile app can't.
 */

import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { FRAME, framesOf, motionOf, type RenderBeat } from "@shorts-studio/domain/direction";
import { fail } from "@shorts-studio/domain/errors";
import { stageOf } from "@shorts-studio/domain/post";
import { Effect, Schema } from "effect";
import { fileStep, writeFileAtomic } from "../files.ts";
import { defineOperation, p } from "../operation.ts";
import { MediaTools } from "../ports.ts";
import { postDir, readPost } from "../post-store.ts";
import { draftInputHash } from "./draft.ts";
import { NextFields, nextOf, nextStep } from "./post.ts";

const FOLDER = "capcut";

const instructions = (clips: number, muted: boolean): string =>
	[
		"Rebuilding this draft in CapCut desktop",
		"",
		`1. New project, 9:16. Import the ${clips} files in clips/ and drag them onto the timeline in name order.`,
		muted
			? "2. The audio isn't included: it's someone else's. Publish with the platform's in-app sound."
			: "2. Import audio.m4a onto the audio track, starting at 0.",
		"3. Captions: Text > Captions > Import, and choose captions.srt.",
		"4. draft-clean.mp4 is the whole draft without captions: put it on a track below to check timing, then remove it.",
		"",
	].join("\n");

export const capcutExport = defineOperation({
	name: "capcut_export",
	description:
		"Export an approved draft for CapCut desktop: capcut/clips/ (one clip per beat with its motion, in order), audio.m4a, captions.srt and draft-clean.mp4. Leaves out audio from someone else's reel (origin others). --mute always leaves the audio out.",
	params: {
		post: p.string("Post slug"),
		mute: p.boolean("Leave the audio out even if it's yours"),
	},
	output: Schema.Struct({
		dir: Schema.String,
		clips: Schema.Int,
		muted: Schema.Boolean,
		...NextFields,
	}),
	surface: "cli-and-mcp",
	spends: false,
	hints: { readonly: false, destructive: false, idempotent: true, openWorld: false },
	run: Effect.fn("capcut_export")(function* (input, ctx) {
		const post = yield* readPost(ctx, input.post);
		const beats = post.beats?.items ?? [];
		if (
			post.audio === undefined ||
			post.draft === undefined ||
			beats.some((b) => b.image === undefined)
		) {
			return yield* fail(
				"not-found",
				`${input.post} has no complete draft to export.`,
				nextStep(post),
			);
		}
		if (stageOf(post) !== "approved") {
			return yield* fail(
				"needs-approval",
				`${input.post} is at "${stageOf(post)}". Only an approved draft can be exported.`,
				`The user reviews it first: post review --post ${input.post} --decision approve`,
			);
		}
		// The clips are rebuilt from the beats as they are now, so they must still be the ones
		// the approved draft was rendered from.
		const media = yield* MediaTools;
		if (post.draft.inputHash !== draftInputHash(ctx, post, media.rendererVersion)) {
			return yield* fail(
				"stale",
				`${input.post}'s beats, images or captions changed after the draft was approved, so the export wouldn't match it.`,
				`Render it again with draft render --post ${input.post}, then the user reviews the new draft.`,
			);
		}
		const muted = input.mute || post.audio.origin === "others";
		const dir = postDir(ctx, input.post);
		const out = join(dir, FOLDER);
		yield* fileStep(() => {
			rmSync(out, { recursive: true, force: true });
			mkdirSync(join(out, "clips"), { recursive: true });
		}, `Check that ${dir} is writable, then run it again.`);

		const renderBeats: ReadonlyArray<RenderBeat> = beats.map((b) => ({
			start: b.start,
			end: b.end,
			image: b.image?.file ?? "",
			motion: motionOf(b.moment, b.motion),
		}));
		ctx.log(`Exporting ${beats.length} clips…`);
		// Each clip starts at 0 with exactly the frames its beat has in the draft, so the clips
		// laid end to end match the draft frame for frame.
		yield* Effect.forEach(
			renderBeats,
			(beat, i) =>
				media.renderVideo({
					cwd: dir,
					beats: [{ ...beat, start: 0, end: framesOf(beat) / FRAME.fps }],
					audio: undefined,
					captions: undefined,
					output: join(
						FOLDER,
						"clips",
						`${String(i + 1).padStart(2, "0")}-beat-${String(i).padStart(2, "0")}.mp4`,
					),
				}),
			{ discard: true },
		);
		yield* media.renderVideo({
			cwd: dir,
			beats: renderBeats,
			audio: muted ? undefined : post.audio.file,
			captions: undefined,
			output: join(FOLDER, "draft-clean.mp4"),
		});
		if (!muted) yield* media.copyAudio(dir, post.audio.file, join(FOLDER, "audio.m4a"));
		// Copy the captions from the last render, so the SRT matches what was approved.
		yield* Effect.try({
			try: () => copyFileSync(join(dir, "captions.srt"), join(out, "captions.srt")),
			catch: () =>
				fail(
					"not-found",
					"captions.srt is missing.",
					`Render the draft again: draft render --post ${input.post} --force`,
				),
		});
		yield* writeFileAtomic(join(out, "README.txt"), instructions(beats.length, muted));
		return { dir: out, clips: beats.length, muted, ...nextOf(post) };
	}),
	render: (o) =>
		`Exported ${o.clips} clips${o.muted ? " (no audio: use the platform's sound)" : ""} to ${o.dir}\nSee README.txt there for the CapCut steps.\nNext: ${o.next}`,
});
