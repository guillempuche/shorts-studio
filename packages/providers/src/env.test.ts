import { Cause, Effect } from "effect";
import { HttpClientError, HttpClientRequest } from "effect/http";
import { describe, expect, it } from "vitest";
import { type PaidService, providerFailure, readFailure } from "./env.ts";

const FAL: PaidService = { id: "fal", name: "FAL", key: { env: "FAL_KEY", keychain: "fal-key" } };
const request = HttpClientRequest.post("https://example.invalid/submit");

/** A failed connection whose cause is `cause`, as fetch reports one. */
const dropped = (cause: unknown, description?: string) =>
	new HttpClientError.HttpClientError({
		reason: new HttpClientError.TransportError({
			request,
			cause,
			...(description === undefined ? {} : { description }),
		}),
	});

/** A system error with `code`, as Node raises one. */
const systemError = (code: string) => Object.assign(new Error(`connect ${code}`), { code });

/** fetch's own error, wrapping why it failed. */
const fetchFailed = (cause: unknown) => new TypeError("fetch failed", { cause });

const sendFailure = (error: unknown) => Effect.runPromise(Effect.flip(providerFailure(FAL)(error)));

describe("providerFailure", () => {
	it.each([
		"ECONNREFUSED",
		"ENOTFOUND",
		"EAI_AGAIN",
		"EHOSTUNREACH",
		"ENETUNREACH",
		"EADDRNOTAVAIL",
		"UND_ERR_CONNECT_TIMEOUT",
		"CERT_HAS_EXPIRED",
		"ERR_TLS_CERT_ALTNAME_INVALID",
		"ERR_SSL_WRONG_VERSION_NUMBER",
		"DEPTH_ZERO_SELF_SIGNED_CERT",
		"SELF_SIGNED_CERT_IN_CHAIN",
		"UNABLE_TO_VERIFY_LEAF_SIGNATURE",
		"UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
	])("should report %s as never sent, so nothing is counted", async (code) => {
		// GIVEN a connection that failed with that code before the request was written
		const error = dropped(fetchFailed(systemError(code)));

		// WHEN it becomes a failure
		const failure = await sendFailure(error);

		// THEN it is NotSent, a provider failure the ledger frees
		expect(failure.reason._tag).toBe("NotSent");
		expect(failure.code).toBe("provider");
	});

	it.each(["ECONNRESET", "EPIPE", "UND_ERR_SOCKET", "EWHATEVER"])(
		"should leave %s as an unknown outcome, since the request may be out",
		async (code) => {
			// GIVEN a connection that failed with that code, maybe after it wrote the request
			const error = dropped(fetchFailed(systemError(code)));

			// WHEN it becomes a failure
			const failure = await sendFailure(error);

			// THEN it is ProviderFailed, which stays counted
			expect(failure.reason._tag).toBe("ProviderFailed");
			expect(failure.fix).toContain("its cost stays counted");
		},
	);

	it("should leave a timeout as an unknown outcome", async () => {
		// GIVEN a call that timed out waiting for the answer
		const error = dropped(
			new Cause.TimeoutError("Operation timed out after 30 seconds"),
			"timed out after 30 seconds",
		);

		// WHEN it becomes a failure
		const failure = await sendFailure(error);

		// THEN it is ProviderFailed, saying why
		expect(failure.reason._tag).toBe("ProviderFailed");
		expect(failure.message).toContain("timed out after 30 seconds");
	});

	it("should name the system error behind a refused connection, and say nothing was counted", async () => {
		// GIVEN a connection refused, wrapped the way fetch wraps it
		const refused = fetchFailed(
			Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:9"), { code: "ECONNREFUSED" }),
		);

		// WHEN it becomes a failure
		const failure = await sendFailure(dropped(refused));

		// THEN the message says why
		expect(failure.message).toContain("ECONNREFUSED");
		// AND the fix says nothing was counted, why, and what the user can change
		expect(failure.reason._tag).toBe("NotSent");
		expect(failure.fix).toMatch(/^Nothing was sent, so nothing was counted\./);
		expect(failure.fix).toContain("(connect ECONNREFUSED 127.0.0.1:9)");
		expect(failure.fix).toContain("Tell the user");
		expect(failure.fix).toContain("SHORTS_FAL_URL");
	});

	it("should count several addresses as never sent only when every one of them failed so", async () => {
		// GIVEN Node trying two addresses: both refused, then one refused and one reset
		const bothRefused = new AggregateError([
			systemError("ECONNREFUSED"),
			systemError("ECONNREFUSED"),
		]);
		const oneReset = new AggregateError([systemError("ECONNREFUSED"), systemError("ECONNRESET")]);

		// WHEN each becomes a failure
		const refused = await sendFailure(dropped(fetchFailed(bothRefused)));
		const reset = await sendFailure(dropped(fetchFailed(oneReset)));

		// THEN only the first is NotSent
		expect(refused.reason._tag).toBe("NotSent");
		expect(reset.reason._tag).toBe("ProviderFailed");
		// AND the message names each address's error
		expect(refused.message).toContain("connect ECONNREFUSED; connect ECONNREFUSED");
	});

	it("should report a port fetch blocks as never sent", async () => {
		// GIVEN fetch refusing a blocked port (such as 9) itself, which it does without a code
		const error = dropped(fetchFailed(new Error("bad port")));

		// WHEN it becomes a failure
		const failure = await sendFailure(error);

		// THEN it is NotSent
		expect(failure.reason._tag).toBe("NotSent");
	});

	it("should report a URL or a body that couldn't be built as never sent", async () => {
		// GIVEN a request whose URL isn't valid, and one whose body couldn't be encoded
		const badUrl = new HttpClientError.HttpClientError({
			reason: new HttpClientError.InvalidUrlError({ request, description: "Invalid URL" }),
		});
		const badBody = new HttpClientError.HttpClientError({
			reason: new HttpClientError.EncodeError({ request, cause: new Error("not encodable") }),
		});

		// WHEN each becomes a failure
		const url = await sendFailure(badUrl);
		const body = await sendFailure(badBody);

		// THEN both are NotSent, saying why
		expect(url.reason._tag).toBe("NotSent");
		expect(url.fix).toContain("(Invalid URL)");
		expect(body.reason._tag).toBe("NotSent");
		expect(body.fix).toContain("(not encodable)");
	});

	it("should stop at a cause that leads back to itself", async () => {
		// GIVEN a cause whose own cause is itself
		const looping = new Error("socket hang up");
		(looping as { cause?: unknown }).cause = looping;

		// WHEN it becomes a failure
		const failure = await sendFailure(dropped(looping));

		// THEN it's still a provider failure with a message, not a crash
		expect(failure.code).toBe("provider");
		expect(failure.message).toContain("socket hang up");
	});
});

describe("readFailure", () => {
	it("should leave a refused connection on a request already taken as an unknown outcome", async () => {
		// GIVEN a check on a request the service took on, whose connection is refused
		const error = dropped(fetchFailed(systemError("ECONNREFUSED")));

		// WHEN it becomes a failure
		const failure = await Effect.runPromise(Effect.flip(readFailure(FAL)(error)));

		// THEN it is ProviderFailed: the job was taken on, so it may have been billed
		expect(failure.reason._tag).toBe("ProviderFailed");
		expect(failure.fix).toContain("its cost stays counted");
	});
});
