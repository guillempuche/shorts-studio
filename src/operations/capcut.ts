/**
 * `capcut export`: everything needed to rebuild the approved draft in CapCut desktop without
 * re-timing a single beat.
 *
 * CapCut has no import format for a whole timeline, and its project files are an unofficial
 * format that breaks between versions. So the hand-off is plain media: one clip per beat, in
 * order, with its motion already applied; the audio; the captions as SRT (CapCut desktop
 * imports SRT, the mobile app can't); and a clean draft to line the clips up against.
 */

import { copyFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Effect, Schema } from "effect";
import { attempt } from "../core/attempt.ts";
import type { Context } from "../core/context.ts";
import { fail } from "../core/errors.ts";
import { defineOperation, p } from "../core/operation.ts";
import { postDir, readPost } from "../core/post-store.ts";
import { motionOf } from "../domain/direction.ts";
import { stageOf } from "../domain/post.ts";
import { FRAME, framesOf, type RenderBeat, renderArgs } from "../work/render.ts";
import { nextStep } from "./post.ts";

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

const run = async (ctx: Context, dir: string, args: ReadonlyArray<string>, signal: AbortSignal) => {
	const result = await ctx.run("ffmpeg", args, { signal, cwd: dir });
	if (result.code !== 0) {
		throw new Error(
			result.stderr.trim().split("\n").slice(-5).join("\n") || `ffmpeg exited with ${result.code}`,
		);
	}
};

export const capcutExport = defineOperation({
	name: "capcut_export",
	description:
		"Export an approved draft for CapCut desktop: capcut/clips/ (one clip per beat with its motion, in order), audio.m4a, captions.srt and draft-clean.mp4. Audio from someone else's reel (origin others) is left out; --mute leaves it out always.",
	params: {
		post: p.string("Post slug"),
		mute: p.boolean("Leave the audio out even if it's yours"),
	},
	output: Schema.Struct({
		dir: Schema.String,
		clips: Schema.Int,
		muted: Schema.Boolean,
		next: Schema.String,
	}),
	surface: "cli-and-mcp",
	spends: false,
	hints: { readonly: false, destructive: false, idempotent: true, openWorld: false },
	run: (input, ctx) =>
		Effect.gen(function* () {
			const post = yield* readPost(ctx, input.post);
			const beats = post.beats?.items ?? [];
			if (
				post.audio === undefined ||
				post.draft === undefined ||
				beats.some((b) => b.image === undefined)
			) {
				return yield* Effect.fail(
					fail("not-found", `${input.post} has no complete draft to export.`, nextStep(post)),
				);
			}
			if (stageOf(post) !== "approved") {
				return yield* Effect.fail(
					fail(
						"needs-confirmation",
						`${input.post} is at "${stageOf(post)}"; only an approved draft is exported.`,
						`The user reviews it first: post review --post ${input.post} --decision approve`,
					),
				);
			}
			const muted = input.mute || post.audio.origin === "others";
			const dir = postDir(ctx, input.post);
			const out = join(dir, FOLDER);
			rmSync(out, { recursive: true, force: true });
			mkdirSync(join(out, "clips"), { recursive: true });

			const renderBeats: ReadonlyArray<RenderBeat> = beats.map((b) => ({
				start: b.start,
				end: b.end,
				image: b.image?.file ?? "",
				motion: motionOf(b.moment, b.motion),
			}));
			ctx.log(`Exporting ${beats.length} clips…`);
			yield* attempt(
				async (signal) => {
					for (const [i, beat] of renderBeats.entries()) {
						// Each clip starts at 0 with exactly the frames the beat has in the draft, so the
						// clips laid end to end match the draft frame for frame.
						const clip = { ...beat, start: 0, end: framesOf(beat) / FRAME.fps };
						const name = join(
							FOLDER,
							"clips",
							`${String(i + 1).padStart(2, "0")}-beat-${String(i).padStart(2, "0")}.mp4`,
						);
						await run(ctx, dir, renderArgs([clip], undefined, undefined, name), signal);
					}
					await run(
						ctx,
						dir,
						renderArgs(
							renderBeats,
							muted ? undefined : post.audio?.file,
							undefined,
							join(FOLDER, "draft-clean.mp4"),
						),
						signal,
					);
					if (!muted) {
						await run(
							ctx,
							dir,
							[
								"-hide_banner",
								"-loglevel",
								"error",
								"-y",
								"-i",
								post.audio?.file ?? "",
								"-c",
								"copy",
								join(FOLDER, "audio.m4a"),
							],
							signal,
						);
					}
				},
				(error) =>
					fail(
						"failed",
						`Export failed: ${error instanceof Error ? error.message : String(error)}`,
						"Check ffmpeg with config show, then run it again.",
					),
			);
			// The captions from the last render, so the SRT matches what was approved.
			yield* attempt(
				async () => {
					copyFileSync(join(dir, "captions.srt"), join(out, "captions.srt"));
				},
				() =>
					fail(
						"not-found",
						"captions.srt is missing.",
						`Render the draft again: draft render --post ${input.post} --force`,
					),
			);
			writeFileSync(join(out, "README.txt"), instructions(beats.length, muted));
			return { dir: out, clips: beats.length, muted, next: nextStep(post) };
		}),
	render: (o) =>
		`Exported ${o.clips} clips${o.muted ? " (no audio: use the platform's sound)" : ""} to ${o.dir}\nSee README.txt there for the CapCut steps.\nNext: ${o.next}`,
});
