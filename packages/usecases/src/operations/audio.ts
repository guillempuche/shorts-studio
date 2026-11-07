/**
 * `audio transcribe`: a transcript of the post's audio, with a time for every word. The words
 * set the beats and the captions. The language is detected for each file unless `--language`
 * forces one. Forcing helps when a video opens with music or a phrase in another language.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { fail } from "@shorts-studio/domain/errors";
import { Transcript } from "@shorts-studio/domain/post";
import { Effect, Schema } from "effect";
import type { Context } from "../context.ts";
import { fileHash, hashOf, readJsonFile, writeJsonFile } from "../files.ts";
import { chooseModel } from "../models.ts";
import { defineOperation, p } from "../operation.ts";
import { Transcriber } from "../ports.ts";
import { postDir, readPost, updatePost } from "../post-store.ts";
import { nextStep } from "./post.ts";

export const TRANSCRIPT_FILE = "transcript.json";

/** The post's transcript, checked against its Schema. A damaged file says how to redo it. */
export const readTranscript = (ctx: Context, slug: string) =>
	readJsonFile(
		join(postDir(ctx, slug), TRANSCRIPT_FILE),
		Transcript,
		`Transcribe it again: audio transcribe --post ${slug} --force`,
	);

export const audioTranscribe = defineOperation({
	name: "audio_transcribe",
	description:
		"Transcribe the post's audio with a timestamp for each word, using the transcription provider in config.json (Together's Whisper large-v3 by default). Skips the work when the transcript is already up to date. Detects the language unless you pass one.",
	params: {
		post: p.string("Post slug"),
		language: p.optional(
			p.string("Two-letter language code (es, en, ca…) to use instead of detecting it"),
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
				return yield* fail(
					"usage",
					`"${input.language}" isn't a two-letter language code.`,
					"Use es, en, ca, fr…, or leave it out to detect the language.",
				);
			}
			const post = yield* readPost(ctx, input.post);
			if (post.audio === undefined) {
				return yield* fail(
					"not-found",
					`${input.post} has no audio.`,
					`Import it first: source import --post ${input.post} --file <audio> --origin mine --kind speech`,
				);
			}
			const dir = postDir(ctx, input.post);
			const file = join(dir, TRANSCRIPT_FILE);
			const transcriber = yield* Transcriber;
			const model = yield* chooseModel(ctx, transcriber, "transcribe");
			const inputHash = hashOf(
				post.audio.hash,
				transcriber.provider,
				model.name,
				input.language ?? "auto",
			);
			if (!input.force && post.transcript?.inputHash === inputHash && existsSync(file)) {
				const saved = yield* readTranscript(ctx, input.post);
				return {
					file,
					language: post.transcript.language,
					words: saved.words.length,
					skipped: true,
					next: nextStep(post),
				};
			}
			ctx.log(`Transcribing ${post.audio.durationSec.toFixed(0)} s of audio…`);
			const transcript = yield* transcriber.transcribe(
				model,
				join(dir, post.audio.file),
				input.language,
			);
			yield* writeJsonFile(file, Transcript, transcript);
			const hash = yield* fileHash(file);
			const updated = yield* updatePost(ctx, input.post, "audio transcribe", (current) =>
				Effect.succeed({
					...current,
					transcript: {
						file: TRANSCRIPT_FILE,
						hash,
						inputHash,
						provider: transcriber.provider,
						model: model.name,
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
