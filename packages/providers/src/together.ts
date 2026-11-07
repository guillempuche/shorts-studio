/**
 * Transcription with word timestamps on Together.ai (Whisper models).
 *
 * `verbose_json` with `timestamp_granularities=word` returns every word with its start and end
 * (docs.together.ai, "Create audio transcription request"). Uploads are capped at 80 MB.
 */

import { openAsBlob, statSync } from "node:fs";
import { basename } from "node:path";
import { fail } from "@shorts-studio/domain/errors";
import type { Model } from "@shorts-studio/domain/models";
import { failWith } from "@shorts-studio/usecases/attempt";
import type { KeySpec } from "@shorts-studio/usecases/context";
import { requireKey } from "@shorts-studio/usecases/inputs";
import { Transcriber } from "@shorts-studio/usecases/ports";
import { Effect, Layer, Schema } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { ProviderEnv, providerFailure } from "./env.ts";

export const TOGETHER_KEY: KeySpec = { env: "TOGETHER_API_KEY", keychain: "together-api-key" };
const BASE_URL = "https://api.together.ai";

/** Together's own models, priced from together.ai/pricing (per minute of audio). */
export const TOGETHER_MODELS = {
	"openai/whisper-large-v3": {
		provider: "together",
		job: "transcribe",
		endpoint: "openai/whisper-large-v3",
		billedBy: "minute",
		usdPerUnit: 0.0015,
		priceChecked: "2026-11-07",
	},
} satisfies Record<string, Model>;

const MAX_UPLOAD_BYTES = 80 * 1024 * 1024;

/** What Together sends back; Whisper names a word's text `word`, some versions `text`. */
const Response = Schema.Struct({
	language: Schema.optionalKey(Schema.String),
	text: Schema.optionalKey(Schema.String),
	words: Schema.optionalKey(
		Schema.Array(
			Schema.Struct({
				word: Schema.optionalKey(Schema.String),
				text: Schema.optionalKey(Schema.String),
				start: Schema.Finite,
				end: Schema.Finite,
			}),
		),
	),
});

const fix = "Check the key and your connection (VPN?), then run it again.";

export const togetherLayer = Layer.effect(
	Transcriber,
	Effect.gen(function* () {
		const env = yield* ProviderEnv;
		const http = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
		const base = env.endpoints["together"] ?? BASE_URL;

		const transcribe = Effect.fn("together.transcribe")(function* (
			model: Model,
			file: string,
			language: string | undefined,
		) {
			const key = yield* requireKey(env, TOGETHER_KEY);
			const size = yield* Effect.try({
				try: () => statSync(file).size,
				catch: failWith("not-found", `Check that ${file} exists, then run it again.`),
			});
			if (size > MAX_UPLOAD_BYTES) {
				return yield* fail(
					"usage",
					`${basename(file)} is ${(size / 1e6).toFixed(0)} MB; Together accepts up to 80 MB.`,
					"Cut the audio shorter, then import it again.",
				);
			}

			const audio = yield* Effect.tryPromise({
				try: () => openAsBlob(file),
				catch: failWith(
					"not-found",
					`Check that ${file} exists and is readable, then run it again.`,
				),
			});
			const form = new FormData();
			form.append("file", audio, basename(file));
			form.append("model", model.endpoint);
			form.append("response_format", "verbose_json");
			form.append("timestamp_granularities", "word");
			form.append("language", language ?? "auto");

			const reply = yield* HttpClientRequest.post(`${base}/v1/audio/transcriptions`).pipe(
				HttpClientRequest.bearerToken(key),
				HttpClientRequest.bodyFormData(form),
				http.execute,
				Effect.flatMap(HttpClientResponse.schemaBodyJson(Response)),
				Effect.catch(providerFailure(fix)),
			);

			const words = (reply.words ?? [])
				.map(({ word, text, start, end }) => ({ text: (word ?? text ?? "").trim(), start, end }))
				.filter((word) => word.text !== "");
			if (words.length === 0) {
				return yield* fail(
					"provider",
					"Together returned no word timings.",
					"Check that there is speech in the audio.",
				);
			}
			return {
				language: reply.language ?? language ?? "unknown",
				text: reply.text?.trim() ?? "",
				words,
			};
		});

		return Transcriber.of({
			provider: "together",
			keys: [TOGETHER_KEY],
			checks: Effect.succeed([]),
			models: TOGETHER_MODELS,
			defaultModel: "openai/whisper-large-v3",
			transcribe,
		});
	}),
);
