/**
 * Bringing audio into a post: your own export, a saved reel's audio, a track made in the Suno,
 * Fish Audio or ElevenLabs apps, or an AI voiceover. Someone else's audio is only a guide track:
 * publish with the platform's in-app sound.
 *
 * Whatever comes in, audio or video, is converted to one `audio/audio.m4a`, so every later step
 * reads the same format. New audio changes the input hashes of the transcript, beats and draft,
 * which marks them out of date.
 */

import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { fail } from "@shorts-studio/domain/errors";
import { Kind, Origin } from "@shorts-studio/domain/post";
import { Effect, Schema } from "effect";
import { failWith } from "../attempt.ts";
import { fileHash } from "../files.ts";
import { defineOperation, p } from "../operation.ts";
import { MediaTools } from "../ports.ts";
import { postDir, readPost, updatePost } from "../post-store.ts";
import { nextStep } from "./post.ts";

const AUDIO_FILE = join("audio", "audio.m4a");

export const sourceImport = defineOperation({
	name: "source_import",
	description:
		"Import an audio or video file as the post's audio (converted to audio/audio.m4a). origin: mine (your own), others (a saved reel: guide track only), ai (generated). kind: speech or music.",
	params: {
		post: p.string("Post slug"),
		file: p.string("Path to an audio or video file"),
		origin: p.literals(Origin.literals, "Who made the audio"),
		kind: p.literals(
			Kind.literals,
			"speech (gets captions and beats from words) or music (beats on a grid)",
		),
	},
	output: Schema.Struct({ file: Schema.String, durationSec: Schema.Finite, next: Schema.String }),
	surface: "cli-and-mcp",
	spends: false,
	hints: { readonly: false, destructive: false, idempotent: true, openWorld: false },
	run: (input, ctx) =>
		Effect.gen(function* () {
			const source = resolve(input.file);
			if (!existsSync(source)) {
				return yield* fail("not-found", `No file at ${source}.`, "Check the path and try again.");
			}
			yield* readPost(ctx, input.post);
			const dir = postDir(ctx, input.post);
			mkdirSync(join(dir, "audio"), { recursive: true });
			const target = join(dir, AUDIO_FILE);
			const tmp = join(dir, "audio", "audio.tmp.m4a");
			const media = yield* MediaTools;
			const durationSec = yield* Effect.gen(function* () {
				yield* media.extractAudio(source, tmp);
				const seconds = yield* media.duration(tmp);
				yield* Effect.try({
					try: () => renameSync(tmp, target),
					catch: failWith("failed", `Check that ${dir} is writable, then run it again.`),
				});
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
			return { file: target, durationSec, next: nextStep(post) };
		}),
	render: (o) => `Imported ${o.durationSec.toFixed(1)} s of audio to ${o.file}\nNext: ${o.next}`,
});
