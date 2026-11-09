/**
 * `audio transcribe`: a transcript of the post's audio, with a time for every word. The words
 * set the beats and the captions. The language is detected for each file unless `--language`
 * forces one. Forcing helps when a video opens with music or a phrase in another language.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { fail } from "@shorts-studio/domain/errors";
import { audioAmount } from "@shorts-studio/domain/models";
import { Transcript } from "@shorts-studio/domain/post";
import { Effect, Schema } from "effect";
import type { Context } from "../context.ts";
import { fileHash, hashOf, readJsonFile, writeJsonFile } from "../files.ts";
import { checkLanguage, requireKey } from "../inputs.ts";
import { paidCall } from "../ledger.ts";
import { chooseModel, costOf } from "../models.ts";
import { defineOperation, p, type RunMode } from "../operation.ts";
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
		"Transcribe the post's audio with a timestamp for each word, using the transcription provider in config.json (Together's Whisper large-v3 by default). Skips the work when the transcript is already up to date. Detects the language unless you pass one. Its cost, by the minute of audio, counts toward the spending caps.",
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
		estimateUsd: Schema.Finite,
		dryRun: Schema.Boolean,
		next: Schema.String,
	}),
	surface: "cli-and-mcp",
	spends: true,
	needsYes: false,
	hints: { readonly: false, destructive: false, idempotent: true, openWorld: true },
	run: Effect.fn("audio_transcribe")(function* (input, ctx, mode: RunMode) {
		yield* checkLanguage(input.language);

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
				estimateUsd: 0,
				dryRun: mode.dryRun,
				next: nextStep(post),
			};
		}

		const cost = costOf(model, audioAmount(model, post.audio.durationSec));
		if (mode.dryRun) {
			return {
				file,
				language: input.language ?? "auto",
				words: 0,
				skipped: false,
				estimateUsd: cost.usd,
				dryRun: true,
				next: nextStep(post),
			};
		}

		// Fail on a missing key before anything is reserved.
		yield* Effect.forEach(transcriber.keys, (key) => requireKey(ctx, key), { discard: true });
		ctx.log(`Transcribing ${post.audio.durationSec.toFixed(0)} s of audio…`);
		const transcript = yield* paidCall(
			ctx,
			{ ...cost, post: input.post, note: "transcript" },
			transcriber.transcribe(model, join(dir, post.audio.file), input.language),
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
			estimateUsd: cost.usd,
			dryRun: false,
			next: nextStep(updated),
		};
	}),
	render: (o) =>
		o.skipped
			? `Transcript is up to date (${o.language}).\nNext: ${o.next}`
			: o.dryRun
				? `Would transcribe the audio (~$${o.estimateUsd.toFixed(3)}); nothing was spent.`
				: `Transcribed ${o.words} words (${o.language}) to ${o.file}\nNext: ${o.next}`,
});
