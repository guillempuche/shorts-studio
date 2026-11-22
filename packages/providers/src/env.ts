/**
 * What every provider's layer asks for: the `ProviderContext` as a service, and Effect's
 * `HttpClient` for the paid services. Also how a failed call to a paid service is sorted, since
 * that decides whether its reservation in the ledger is freed.
 */

import {
	failBecause,
	NotSent,
	ProviderFailed,
	type Reason,
	Refused,
	type ShortsError,
} from "@shorts-studio/domain/errors";
import type { KeySpec } from "@shorts-studio/usecases/context";
import type { Check } from "@shorts-studio/usecases/ports";
import { Context, Effect, Layer } from "effect";
import { FetchHttpClient, type HttpClient, HttpClientError } from "effect/http";
import { type ProviderContext, urlVariable } from "./node.ts";

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
 * A warning row when `SHORTS_<PROVIDER>_URL` sends a paid provider's requests elsewhere: a test
 * address left set would make every real run fail, or reach a service that isn't the provider.
 */
export const addressChecks = (ctx: ProviderContext, provider: string): ReadonlyArray<Check> => {
	const address = ctx.endpoints[provider];
	if (address === undefined) return [];
	const variable = urlVariable(provider);
	return [
		{
			name: variable,
			status: "warn",
			detail: `${provider} requests go to ${address}, not ${provider}'s own service`,
			fix: `Unset ${variable} to reach ${provider} itself; keep it only while testing.`,
			// What its paid calls would fail with, not a missing tool.
			code: "provider",
		},
	];
};

/** A paid service, as the fix messages name it. */
export interface PaidService {
	/** Its name in `SHORTS_<ID>_URL` and config.json, such as `fal`. */
	readonly id: string;
	/** Its name as the user knows it, such as FAL. */
	readonly name: string;
	readonly key: KeySpec;
}

/**
 * The innermost error behind `cause`: for fetch, the system error (ECONNREFUSED…) behind
 * "fetch failed". When Node tried several addresses, that's an `AggregateError` of one per address.
 */
const deepest = (cause: unknown, seen: ReadonlySet<unknown> = new Set()): Error | undefined =>
	cause instanceof Error && !seen.has(cause)
		? (deepest(cause.cause, new Set([...seen, cause])) ?? cause)
		: undefined;

/** An error's own words; an `AggregateError` has none, only its errors'. */
const wordsOf = (error: Error): string =>
	error instanceof AggregateError && error.message === ""
		? error.errors
				.map((inner) => (inner instanceof Error ? inner.message : String(inner)))
				.join("; ")
		: error.message;

/**
 * Codes raised before a request's first byte is written, so the service never saw it.
 * `ECONNRESET`, `EPIPE` and `UND_ERR_SOCKET` are left off on purpose: a reused connection can
 * raise them after it wrote the request.
 */
const NOT_SENT_CODES: ReadonlySet<string> = new Set([
	"ECONNREFUSED",
	"ENOTFOUND",
	"EAI_AGAIN",
	"EHOSTUNREACH",
	"ENETUNREACH",
	"EADDRNOTAVAIL",
	"UND_ERR_CONNECT_TIMEOUT",
	"DEPTH_ZERO_SELF_SIGNED_CERT",
	"SELF_SIGNED_CERT_IN_CHAIN",
	"UNABLE_TO_VERIFY_LEAF_SIGNATURE",
	"UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
	"ERR_TLS_CERT_ALTNAME_INVALID",
	"ERR_TLS_HANDSHAKE_TIMEOUT",
	"ERR_SSL_WRONG_VERSION_NUMBER",
]);
/**
 * Certificate checks, which run during the handshake. Other `ERR_SSL_` and `ERR_TLS_` codes are left
 * off: a reused connection can raise them after it wrote the request.
 */
const NOT_SENT_PREFIXES = ["CERT_"];

const neverSent = (error: Error): boolean => {
	if (error instanceof AggregateError) {
		// One per address tried: if any of them got as far as sending, the request may be out.
		return (
			error.errors.length > 0 &&
			error.errors.every((inner) => inner instanceof Error && neverSent(inner))
		);
	}
	const code = (error as { readonly code?: unknown }).code;
	if (typeof code === "string") {
		return NOT_SENT_CODES.has(code) || NOT_SENT_PREFIXES.some((prefix) => code.startsWith(prefix));
	}
	// fetch refuses the ports browsers block (1, 9…) itself, before connecting, without a code.
	return error.message === "bad port";
};

/**
 * Why `error` proves the request never left this machine, or undefined when it may have. A URL
 * or body that couldn't be built stops it before sending; so do the connection failures above.
 */
const notSentBecause = (error: unknown): string | undefined => {
	if (!HttpClientError.isHttpClientError(error)) return undefined;
	const { reason } = error;
	if (reason._tag === "InvalidUrlError" || reason._tag === "EncodeError") {
		const cause = deepest(reason.cause);
		return reason.description ?? (cause === undefined ? reason.message : wordsOf(cause));
	}
	if (reason._tag !== "TransportError") return undefined;
	const cause = deepest(reason.cause);
	return cause !== undefined && neverSent(cause) ? wordsOf(cause) : undefined;
};

/** An HTTP 4xx's status: the service read the request and said no. */
const refusedStatus = (error: unknown): number | undefined => {
	if (!HttpClientError.isHttpClientError(error) || error.reason._tag !== "StatusCodeError") {
		return undefined;
	}
	const { status } = error.reason.response;
	return status >= 400 && status < 500 ? status : undefined;
};

/**
 * A failed call in words. For an error status: the status, the method and URL (with secrets in
 * it redacted) and the start of the body sent back. For a connection that failed: why, so the
 * fix has something to go on.
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
		const why = description === undefined ? deepest(cause) : undefined;
		return Effect.succeed(why === undefined ? error.message : `${error.message}: ${wordsOf(why)}`);
	}
	return Effect.succeed(error instanceof Error ? error.message : String(error));
};

// Each fix starts by saying whether the cost was counted, since that decides whether running it
// again pays twice.

const notSentFix = (service: PaidService, why: string): string =>
	`Nothing was sent, so nothing was counted. ${service.name} can't be reached from this machine (${why}). Tell the user: it needs a working connection, without a VPN or firewall blocking it, or a correct ${urlVariable(service.id)}. Running it again before that fails the same way.`;

const refusedFix = (service: PaidService, status: number): string => {
	const counted = `${service.name} refused the request, so nothing was counted.`;
	const same = "Running it again unchanged gets the same answer.";
	if (status === 401 || status === 403) {
		return `${counted} It didn't accept ${service.key.env}: check it first. ${same}`;
	}
	if (status === 429) {
		return `${counted} It's limiting how often it's called: wait a minute, then run it again.`;
	}
	return `${counted} Check the request itself: the model's options in config.json, or the input. ${same}`;
};

const UNKNOWN_FIX =
	"The outcome is unknown, so its cost stays counted. Running it again pays for a new request: wait a few minutes first.";

/** For a request the service ended without a result, which it doesn't bill. */
export const endedFix = (service: PaidService): string =>
	`${service.name} ended the request without a result, so nothing was counted. Running it again sends a new request.`;

const readFix = (service: PaidService): string =>
	`${service.name} took this request on, so its cost stays counted. Check the connection and ${service.key.env}, then check on the same request again rather than sending a new one.`;

/** Which of the reasons `error` is, for a call that asks `service` to take a job on. */
const sendingReason = (service: PaidService, error: unknown, message: string): Reason => {
	const why = notSentBecause(error);
	if (why !== undefined) return new NotSent({ message, fix: notSentFix(service, why) });
	const status = refusedStatus(error);
	if (status !== undefined) return new Refused({ message, fix: refusedFix(service, status) });
	return new ProviderFailed({ message, fix: UNKNOWN_FIX });
};

/**
 * For a call that asks the service to take a job on (submit, transcribe): turns any HTTP or
 * decoding failure into a `provider` error. A request that never left the machine is `NotSent`
 * and a 4xx is `Refused`, both of which billed nothing. Anything else leaves the outcome unknown:
 * a gateway can answer 5xx, or a connection drop, after the service took the job on.
 */
export const providerFailure =
	(service: PaidService) =>
	(error: unknown): Effect.Effect<never, ShortsError> =>
		explain(error).pipe(
			Effect.flatMap((message) => Effect.fail(failBecause(sendingReason(service, error, message)))),
		);

/**
 * For a call about a job the service already took on (checking on it, fetching its result):
 * every failure leaves the outcome unknown, a 4xx included. The job may have run and been
 * billed, so this never says `Refused` or `NotSent`, which the ledger reads as "nothing was billed".
 */
export const readFailure =
	(service: PaidService) =>
	(error: unknown): Effect.Effect<never, ShortsError> =>
		explain(error).pipe(
			Effect.flatMap((message) =>
				Effect.fail(failBecause(new ProviderFailed({ message, fix: readFix(service) }))),
			),
		);
