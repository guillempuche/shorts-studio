/**
 * `audio transcribe`: word-timed transcript of the post's audio. The words drive the beats and
 * the captions. Language is detected per file unless `--language` forces one, which helps
 * when a video opens with music or a phrase in another language.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Effect, Schema } from "effect";
import { attempt, failWith } from "../core/attempt.ts";
import { fail } from "../core/errors.ts";
import { hashFile, hashOf, writeFileAtomic } from "../core/files.ts";
import { defineOperation, p } from "../core/operation.ts";
import { postDir, readPost, updatePost } from "../core/post-store.ts";
import { TOGETHER_MODEL, transcribe } from "../work/together.ts";
import { nextStep } from "./post.ts";

export const TRANSCRIPT_FILE = "transcript.json";
const PROVIDER = "together";

export const audioTranscribe = defineOperation({
	name: "audio_transcribe",
	description:
		"Transcribe the post's audio with word timestamps (Together, Whisper large-v3). Skips when the transcript is already up to date; language is auto-detected unless given.",
	params: {
		post: p.string("Post slug"),
		language: p.optional(
			p.string("Two-letter language code (es, en, ca…) to force instead of auto-detect"),
		),
		force: p.boolean("Transcribe again even if the transcript is up to date"),
	},
	output: Schema.Struct({
		file: Schema.String,
		language: Schema.String,
		words: Schema.Int,
		skipped: Schema.Boolean,
		next: Schema.String,
	}),
	surface: "cli-and-mcp",
	spends: false,
	hints: { readonly: false, destructive: false, idempotent: true, openWorld: true },
	run: (input, ctx) =>
		Effect.gen(function* () {
			if (input.language !== undefined && !/^[a-z]{2}$/.test(input.language)) {
				return yield* Effect.fail(
					fail(
						"usage",
						`"${input.language}" isn't a two-letter language code.`,
						"Use es, en, ca, fr… or leave it out to auto-detect.",
					),
				);
			}
			const post = yield* readPost(ctx, input.post);
			if (post.audio === undefined) {
				return yield* Effect.fail(
					fail(
						"not-found",
						`${input.post} has no audio.`,
						`Import it first: source import --post ${input.post} --file <audio> --origin mine --kind speech`,
					),
				);
			}
			const dir = postDir(ctx, input.post);
			const inputHash = hashOf(post.audio.hash, PROVIDER, TOGETHER_MODEL, input.language ?? "auto");
			if (!input.force && post.transcript?.inputHash === inputHash) {
				return {
					file: join(dir, TRANSCRIPT_FILE),
					language: post.transcript.language,
					words: (
						JSON.parse(readFileSync(join(dir, TRANSCRIPT_FILE), "utf8")) as { words: unknown[] }
					).words.length,
					skipped: true,
					next: nextStep(post),
				};
			}
			const key = yield* Effect.promise(() => ctx.secret("TOGETHER_API_KEY"));
			if (key === undefined) {
				return yield* Effect.fail(
					fail(
						"missing-key",
						"TOGETHER_API_KEY isn't set.",
						"Set it in your environment or the Keychain: config show explains how.",
					),
				);
			}
			ctx.log(`Transcribing ${post.audio.durationSec.toFixed(0)} s of audio…`);
			const transcript = yield* attempt(
				(signal) => transcribe(ctx, key, join(dir, post.audio?.file ?? ""), input.language, signal),
				failWith("provider", "Check the key and your connection (VPN?), then run it again."),
			);
			const file = join(dir, TRANSCRIPT_FILE);
			writeFileAtomic(file, `${JSON.stringify(transcript, null, 2)}\n`);
			const hash = yield* Effect.promise(() => hashFile(file));
			const updated = yield* updatePost(ctx, input.post, "audio transcribe", (current) =>
				Effect.succeed({
					...current,
					transcript: {
						file: TRANSCRIPT_FILE,
						hash,
						inputHash,
						provider: PROVIDER,
						model: TOGETHER_MODEL,
						language: transcript.language,
					},
				}),
			);
			return {
				file,
				language: transcript.language,
				words: transcript.words.length,
				skipped: false,
				next: nextStep(updated),
			};
		}),
	render: (o) =>
		o.skipped
			? `Transcript is up to date (${o.language}).\nNext: ${o.next}`
			: `Transcribed ${o.words} words (${o.language}) to ${o.file}\nNext: ${o.next}`,
});
