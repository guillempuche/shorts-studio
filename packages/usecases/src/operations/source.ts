/**
 * Bringing audio into a post: your own export, a saved reel's audio, a track made in the Suno,
 * Fish Audio or ElevenLabs apps, or an AI voiceover. Someone else's audio is only a guide track:
 * publish with the platform's in-app sound.
 *
 * Whatever comes in, audio or video, is converted to one `audio/audio.m4a`, so every later step
 * reads the same format. New audio changes the audio's hash: the transcript records the hash it
 * was made from, so `freshnessOf` counts it out of date, and the beats and draft built from it.
 */

import { renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fail, type ShortsError } from "@shorts-studio/domain/errors";
import { Kind, Origin } from "@shorts-studio/domain/post";
import { Effect, Schema } from "effect";
import { ensureDir, fileHash, fileStep } from "../files.ts";
import { inputFile, RELATIVE_PATH } from "../inputs.ts";
import { defineOperation, p } from "../operation.ts";
import { MediaTools } from "../ports.ts";
import { postDir, readPost, refuseArchived, updatePost } from "../post-store.ts";
import { NextFields, nextOf } from "./post.ts";

const AUDIO_FILE = join("audio", "audio.m4a");

/**
 * Audio whose loudest point is at or below this, in dBFS, counts as silent. Speech and music
 * peak far above it, and digital silence reads about −91; a silent post would only be paid
 * for at transcription and found out at 0 words.
 */
export const SILENT_DB = -60;

export const sourceImport = defineOperation({
	name: "source_import",
	description:
		"Import an audio or video file as the post's audio (converted to audio/audio.m4a). origin: mine (your own), others (a saved reel: guide track only), ai (generated). kind: speech or music.",
	params: {
		post: p.string("Post slug"),
		file: p.string(`Path to an audio or video file; ${RELATIVE_PATH}`),
		origin: p.literals(Origin.literals, "Who made the audio"),
		kind: p.literals(
			Kind.literals,
			"speech (gets captions and beats from words) or music (beats on a grid)",
		),
	},
	output: Schema.Struct({ file: Schema.String, durationSec: Schema.Finite, ...NextFields }),
	surface: "cli-and-mcp",
	spends: false,
	hints: { readonly: false, destructive: false, idempotent: true, openWorld: false },
	run: Effect.fn("source_import")(function* (input, ctx) {
		const source = yield* inputFile(input.file, "Check the path and try again.");
		const media = yield* MediaTools;
		const streams = yield* media.audioStreams(source);
		if (streams === undefined || streams === 0) {
			return yield* fail(
				"usage",
				streams === undefined
					? `${source} isn't audio or video that ffmpeg can read.`
					: `${source} has no audio track.`,
				"Pass an audio file, or a video with sound: m4a, mp3, wav, mp4 or mov.",
			);
		}
		yield* refuseArchived(yield* readPost(ctx, input.post), "source import");
		const dir = postDir(ctx, input.post);
		yield* ensureDir(join(dir, "audio"));
		const target = join(dir, AUDIO_FILE);
		const tmp = join(dir, "audio", "audio.tmp.m4a");
		const durationSec = yield* Effect.gen(function* () {
			// Their errors would name the temporary file; the user knows only the one they gave.
			const fromSource = Effect.mapError((error: ShortsError) =>
				fail(
					error.code,
					`${source} couldn't be converted to audio: ${error.message.replaceAll(tmp, source)}`,
					error.fix,
				),
			);
			yield* media.extractAudio(source, tmp).pipe(fromSource);
			const peak = yield* media.peakDb(tmp).pipe(fromSource);
			if (peak <= SILENT_DB) {
				return yield* fail(
					"usage",
					`${source} is silent: its loudest point is ${Number.isFinite(peak) ? `${peak.toFixed(1)} dBFS` : "digital silence"}.`,
					"Check the recording's level, or that the right file was exported.",
				);
			}
			const seconds = yield* media.duration(tmp);
			yield* fileStep(
				() => renameSync(tmp, target),
				`Check that ${dir} is writable, then run it again.`,
			);
			return seconds;
		}).pipe(Effect.ensuring(Effect.sync(() => rmSync(tmp, { force: true }))));
		const hash = yield* fileHash(target);
		const post = yield* updatePost(ctx, input.post, "source import", (post) =>
			Effect.succeed({
				...post,
				audio: {
					file: AUDIO_FILE,
					hash,
					origin: input.origin,
					kind: input.kind,
					durationSec,
					source,
				},
			}),
		);
		return { file: target, durationSec, ...(yield* nextOf(ctx, post)) };
	}),
	render: (o) => `Imported ${o.durationSec.toFixed(1)} s of audio to ${o.file}\nNext: ${o.next}`,
});
