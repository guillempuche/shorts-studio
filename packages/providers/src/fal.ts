/**
 * Image generation on FAL through its queue API (docs.fal.ai, "Queue API").
 *
 * Submitting and collecting are separate calls on purpose. The use case saves the request's
 * status and result URLs before waiting, so a run that is cut short picks up the same request
 * next time instead of paying for a new one.
 */

import { IMAGE_SIZE } from "@shorts-studio/domain/direction";
import { failBecause, RequestEnded } from "@shorts-studio/domain/errors";
import type { Model } from "@shorts-studio/domain/models";
import type { KeySpec } from "@shorts-studio/usecases/context";
import { requireKey } from "@shorts-studio/usecases/inputs";
import { ImageMaker, type ImageRequest } from "@shorts-studio/usecases/ports";
import { Effect, Layer, Redacted, Schedule, Schema } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { ProviderEnv, providerFailure } from "./env.ts";

export const FAL_KEY: KeySpec = { env: "FAL_KEY", keychain: "fal-key" };
const BASE_URL = "https://queue.fal.run";

/**
 * FAL's own models, priced from their pages on fal.ai. FAL bills each image by the megapixel,
 * rounded up: 1344×2400 is 3.2 MP, billed as 4.
 */
export const FAL_MODELS = {
	"flux-schnell": {
		provider: "fal",
		job: "image",
		endpoint: "fal-ai/flux/schnell",
		billedBy: "megapixel",
		usdPerUnit: 0.003,
		roundUp: true,
		priceChecked: "2026-11-07",
		options: { num_inference_steps: 4 },
	},
	"flux-dev": {
		provider: "fal",
		job: "image",
		endpoint: "fal-ai/flux/dev",
		billedBy: "megapixel",
		usdPerUnit: 0.025,
		roundUp: true,
		priceChecked: "2026-11-07",
		options: { num_inference_steps: 28 },
	},
} satisfies Record<string, Model>;

const Submitted = Schema.Struct({
	request_id: Schema.String,
	status_url: Schema.String,
	response_url: Schema.String,
});
const Status = Schema.Struct({ status: Schema.String });
const Result = Schema.Struct({ images: Schema.Array(Schema.Struct({ url: Schema.String })) });

const fix = "Check FAL_KEY and your connection, then run it again.";

const ended = (message: string) =>
	Effect.fail(failBecause(new RequestEnded({ message, fix: "Submit a new request." })));

export const falLayer = Layer.effect(
	ImageMaker,
	Effect.gen(function* () {
		const env = yield* ProviderEnv;
		const http = (yield* HttpClient.HttpClient).pipe(HttpClient.filterStatusOk);
		// Reading a request again is harmless, so those calls retry a dropped connection.
		// Submitting is never retried: it pays.
		const reader = http.pipe(
			HttpClient.retryTransient({ schedule: Schedule.exponential("200 millis"), times: 3 }),
		);

		const base = env.endpoints["fal"] ?? BASE_URL;
		const signed = (key: Redacted.Redacted<string>) =>
			HttpClientRequest.setHeader("Authorization", `Key ${Redacted.value(key)}`);

		const read = <S extends Schema.Top>(key: Redacted.Redacted<string>, url: string, schema: S) =>
			HttpClientRequest.get(url).pipe(
				signed(key),
				reader.execute,
				Effect.flatMap(HttpClientResponse.schemaBodyJson(schema)),
			);

		/** Asks every second until FAL is done with the request. */
		const finalStatus = (
			key: Redacted.Redacted<string>,
			request: ImageRequest,
		): Effect.Effect<string, unknown> =>
			read(key, request.statusUrl, Status).pipe(
				Effect.flatMap(({ status }) =>
					status === "IN_QUEUE" || status === "IN_PROGRESS"
						? Effect.sleep("1 second").pipe(Effect.andThen(finalStatus(key, request)))
						: Effect.succeed(status),
				),
			);

		const submit = Effect.fn("fal.submit")(function* (model: Model, prompt: string, seed: number) {
			const key = yield* requireKey(env, FAL_KEY);
			const queued = yield* HttpClientRequest.post(`${base}/${model.endpoint}`).pipe(
				signed(key),
				HttpClientRequest.bodyJsonUnsafe({
					output_format: "jpeg",
					enable_safety_checker: true,
					// A model added in config.json can change the fields above…
					...model.options,
					// …but not these: the estimate and the reservation were made for one image of this
					// size, and the seed and prompt are what a resumed or rerolled beat is matched by.
					prompt,
					image_size: IMAGE_SIZE,
					seed,
					num_images: 1,
				}),
				http.execute,
				Effect.flatMap(HttpClientResponse.schemaBodyJson(Submitted)),
				Effect.catch(providerFailure(fix)),
			);
			return {
				requestId: queued.request_id,
				statusUrl: queued.status_url,
				responseUrl: queued.response_url,
			};
		});

		const collect = Effect.fn("fal.collect")(function* (request: ImageRequest) {
			const key = yield* requireKey(env, FAL_KEY);

			const status = yield* finalStatus(key, request).pipe(Effect.catch(providerFailure(fix)));
			if (status !== "COMPLETED") {
				return yield* ended(`FAL request ${request.requestId} ended as ${status}`);
			}

			const result = yield* read(key, request.responseUrl, Result).pipe(
				Effect.catch(providerFailure(fix)),
			);
			const url = result.images[0]?.url;
			if (url === undefined) {
				return yield* ended(`FAL request ${request.requestId} returned no image`);
			}

			const bytes = yield* reader.get(url).pipe(
				Effect.flatMap((response) => response.arrayBuffer),
				Effect.catch(providerFailure(fix)),
			);
			return new Uint8Array(bytes);
		});

		return ImageMaker.of({
			provider: "fal",
			keys: [FAL_KEY],
			checks: Effect.succeed([]),
			models: FAL_MODELS,
			defaultModel: "flux-schnell",
			submit,
			collect,
		});
	}),
);
