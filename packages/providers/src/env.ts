/**
 * What every provider's layer asks for: the `ProviderContext` as a service, and Effect's
 * `HttpClient` for the paid services.
 */

import { fail, type ShortsError } from "@shorts-studio/domain/errors";
import { Context, Effect, Layer } from "effect";
import { FetchHttpClient, type HttpClient, HttpClientError } from "effect/http";
import type { ProviderContext } from "./node.ts";

export class ProviderEnv extends Context.Service<ProviderEnv, ProviderContext>()(
	"shorts-studio/ProviderEnv",
) {}

/** A provider's layer with what it needs: this context, and HTTP over the platform's fetch. */
export const withEnv = <A, E>(
	layer: Layer.Layer<A, E, ProviderEnv | HttpClient.HttpClient>,
	ctx: ProviderContext,
): Layer.Layer<A, E> =>
	layer.pipe(Layer.provide(Layer.succeed(ProviderEnv, ctx)), Layer.provide(FetchHttpClient.layer));

/** A failed call in words: for an error status, the status and the start of the body sent back. */
const explain = (error: unknown): Effect.Effect<string> => {
	if (HttpClientError.isHttpClientError(error) && error.reason._tag === "StatusCodeError") {
		const { response } = error.reason;
		return response.text.pipe(
			Effect.map(
				(body) => `HTTP ${response.status} from ${response.request.url}: ${body.slice(0, 300)}`,
			),
			Effect.orElseSucceed(() => error.message),
		);
	}
	return Effect.succeed(error instanceof Error ? error.message : String(error));
};

/** Turns any HTTP or decoding failure into a `provider` error with `fix` as the next step. */
export const providerFailure =
	(fix: string) =>
	(error: unknown): Effect.Effect<never, ShortsError> =>
		explain(error).pipe(Effect.flatMap((message) => Effect.fail(fail("provider", message, fix))));
