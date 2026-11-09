/**
 * What every provider's layer asks for: the `ProviderContext` as a service, and Effect's
 * `HttpClient` for the paid services.
 */

import { fail, failBecause, Refused, type ShortsError } from "@shorts-studio/domain/errors";
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

/**
 * The innermost cause's message: for fetch, the system error (ECONNREFUSED…) behind
 * "fetch failed".
 */
const deepestMessage = (
	cause: unknown,
	seen: ReadonlySet<unknown> = new Set(),
): string | undefined =>
	cause instanceof Error && !seen.has(cause)
		? (deepestMessage(cause.cause, new Set([...seen, cause])) ?? cause.message)
		: undefined;

/**
 * A failed call in words. For an error status: the status, the method and URL (with secrets in
 * it redacted) and the start of the body sent back. For a connection that failed: why, so the
 * fix's "check your connection" has something to go on.
 */
const explain = (error: unknown): Effect.Effect<string> => {
	if (HttpClientError.isHttpClientError(error) && error.reason._tag === "StatusCodeError") {
		const { response, methodAndUrl } = error.reason;
		return response.text.pipe(
			Effect.map((body) => `HTTP ${response.status} from ${methodAndUrl}: ${body.slice(0, 300)}`),
			Effect.orElseSucceed(() => error.message),
		);
	}
	if (HttpClientError.isHttpClientError(error) && error.reason._tag === "TransportError") {
		const { description, cause } = error.reason;
		// A timeout already says why in its description; a failed fetch says why only in its cause.
		const why = description === undefined ? deepestMessage(cause) : undefined;
		return Effect.succeed(why === undefined ? error.message : `${error.message}: ${why}`);
	}
	return Effect.succeed(error instanceof Error ? error.message : String(error));
};

/** An HTTP 4xx: the provider read the request and said no. */
const isClientError = (error: unknown): boolean =>
	HttpClientError.isHttpClientError(error) &&
	error.reason._tag === "StatusCodeError" &&
	error.reason.response.status >= 400 &&
	error.reason.response.status < 500;

const failure =
	(fix: string, refusable: boolean) =>
	(error: unknown): Effect.Effect<never, ShortsError> =>
		explain(error).pipe(
			Effect.flatMap((message) =>
				Effect.fail(
					refusable && isClientError(error)
						? failBecause(new Refused({ message, fix }))
						: fail("provider", message, fix),
				),
			),
		);

/**
 * For a call that asks the provider to take a job on (submit, transcribe): turns any HTTP or
 * decoding failure into a `provider` error with `fix` as the next step. A 4xx is a refusal,
 * which billed nothing. Anything else leaves the outcome unknown: a gateway can answer 5xx after
 * the provider took the job on.
 */
export const providerFailure = (fix: string) => failure(fix, true);

/**
 * For a call about a job the provider already took on (checking on it, fetching its result):
 * every failure leaves the outcome unknown, a 4xx included. The job may have run and been
 * billed, so this never says `Refused`, which the ledger reads as "nothing was billed".
 */
export const readFailure = (fix: string) => failure(fix, false);
