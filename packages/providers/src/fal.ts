/**
 * Image generation on FAL through its queue API (docs.fal.ai, "Queue API").
 *
 * Submitting and collecting are separate calls on purpose. The use case saves the request's
 * status and result URLs before waiting, so a run that is cut short picks up the same request
 * next time instead of paying for a new one.
 */

import { IMAGE_SIZE } from "@shorts-studio/domain/direction";
import { fail, failBecause, RequestEnded } from "@shorts-studio/domain/errors";
import type { KeySpec } from "@shorts-studio/usecases/context";
import { requireKey } from "@shorts-studio/usecases/inputs";
import { ImageMaker, type ImageRequest } from "@shorts-studio/usecases/ports";
import { Effect, Layer, Schedule, Schema } from "effect";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";
import { ProviderEnv, providerFailure } from "./env.ts";

export const FAL_KEY: KeySpec = { env: "FAL_KEY", keychain: "fal-key" };
const BASE_URL = "https://queue.fal.run";

interface FalModel {
	readonly endpoint: string;
	/** For estimates only; FAL bills these models per megapixel. */
	readonly usdPerMegapixel: number;
	readonly steps: number;
}

const MODELS: Readonly<Record<string, FalModel>> = {
	"flux-schnell": { endpoint: "fal-ai/flux/schnell", usdPerMegapixel: 0.003, steps: 4 },
	"flux-dev": { endpoint: "fal-ai/flux/dev", usdPerMegapixel: 0.025, steps: 28 },
};

const Submitted = Schema.Struct({
	request_id: Schema.String,
	status_url: Schema.String,
	response_url: Schema.String,
});
const Status = Schema.Struct({ status: Schema.String });
const Result = Schema.Struct({ images: Schema.Array(Schema.Struct({ url: Schema.String })) });

const megapixels = (IMAGE_SIZE.width * IMAGE_SIZE.height) / 1_000_000;
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
		const signed = (key: string) => HttpClientRequest.setHeader("Authorization", `Key ${key}`);

		const read = <S extends Schema.Top>(key: string, url: string, schema: S) =>
			HttpClientRequest.get(url).pipe(
				signed(key),
				reader.execute,
				Effect.flatMap(HttpClientResponse.schemaBodyJson(schema)),
			);

		/** Checks every second until FAL is done with the request; returns how it ended. */
		const finished = (key: string, request: ImageRequest): Effect.Effect<string, unknown> =>
			read(key, request.statusUrl, Status).pipe(
				Effect.flatMap(({ status }) =>
					status === "IN_QUEUE" || status === "IN_PROGRESS"
						? Effect.sleep("1 second").pipe(Effect.andThen(finished(key, request)))
						: Effect.succeed(status),
				),
			);

		const submit = Effect.fn("fal.submit")(function* (name: string, prompt: string, seed: number) {
			const model = MODELS[name];
			if (model === undefined) {
				return yield* fail(
					"usage",
					`FAL has no model "${name}".`,
					`Use one of: ${Object.keys(MODELS).join(", ")}.`,
				);
			}
			const key = yield* requireKey(env, FAL_KEY);
			const body = yield* HttpClientRequest.post(`${base}/${model.endpoint}`).pipe(
				signed(key),
				HttpClientRequest.bodyJsonUnsafe({
					prompt,
					image_size: IMAGE_SIZE,
					seed,
					num_images: 1,
					num_inference_steps: model.steps,
					output_format: "jpeg",
					enable_safety_checker: true,
				}),
				http.execute,
				Effect.flatMap(HttpClientResponse.schemaBodyJson(Submitted)),
				Effect.catch(providerFailure(fix)),
			);
			return {
				requestId: body.request_id,
				statusUrl: body.status_url,
				responseUrl: body.response_url,
			};
		});

		const collect = Effect.fn("fal.collect")(function* (request: ImageRequest) {
			const key = yield* requireKey(env, FAL_KEY);
			const status = yield* finished(key, request).pipe(Effect.catch(providerFailure(fix)));
			if (status !== "COMPLETED") {
				return yield* ended(`FAL request ${request.requestId} ended as ${status}`);
			}
			const result = yield* read(key, request.responseUrl, Result).pipe(
				Effect.catch(providerFailure(fix)),
			);
			const url = result.images[0]?.url;
			if (url === undefined)
				return yield* ended(`FAL request ${request.requestId} returned no image`);
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
			models: Object.keys(MODELS),
			defaultModel: "flux-schnell",
			estimateUsd: (name) => megapixels * (MODELS[name]?.usdPerMegapixel ?? 0),
			submit,
			collect,
		});
	}),
);
