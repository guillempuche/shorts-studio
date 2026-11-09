import { Effect } from "effect";
import { HttpClientError, HttpClientRequest } from "effect/http";
import { describe, expect, it } from "vitest";
import { providerFailure } from "./env.ts";

/** A failed connection whose cause is `cause`, as fetch reports one. */
const dropped = (cause: unknown) =>
	new HttpClientError.HttpClientError({
		reason: new HttpClientError.TransportError({
			request: HttpClientRequest.get("https://example.invalid/status"),
			cause,
		}),
	});

describe("providerFailure", () => {
	it("should name the system error behind a failed connection", async () => {
		// GIVEN a connection refused, wrapped the way fetch wraps it
		const refused = new Error("fetch failed", { cause: new Error("connect ECONNREFUSED") });

		// WHEN it becomes a failure
		const error = await Effect.runPromise(Effect.flip(providerFailure("Retry.")(dropped(refused))));

		// THEN the message says why, and the outcome counts as unknown
		expect(error.message).toContain("ECONNREFUSED");
		expect(error.reason._tag).toBe("ProviderFailed");
	});

	it("should stop at a cause that leads back to itself", async () => {
		// GIVEN a cause whose own cause is itself
		const looping = new Error("socket hang up");
		(looping as { cause?: unknown }).cause = looping;

		// WHEN it becomes a failure
		const error = await Effect.runPromise(Effect.flip(providerFailure("Retry.")(dropped(looping))));

		// THEN it's still a provider failure with a message, not a crash
		expect(error.code).toBe("provider");
		expect(error.message).toContain("socket hang up");
	});
});
