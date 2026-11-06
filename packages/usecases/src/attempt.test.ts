import { Effect, Fiber } from "effect";
import { describe, expect, it } from "vitest";
import { attempt, failWith } from "./attempt.ts";

describe("attempt", () => {
	it("should finish an interruption only once the abandoned work has settled", async () => {
		// GIVEN work that takes 300 ms to wind down after it's told to stop
		let settled = false;
		const work = attempt(
			(signal) =>
				new Promise<void>((resolve) => {
					signal.addEventListener("abort", () =>
						setTimeout(() => {
							settled = true;
							resolve();
						}, 300),
					);
				}),
			failWith("failed", "unused"),
		);
		const fiber = Effect.runFork(work);
		await new Promise((resolve) => setTimeout(resolve, 50));

		// WHEN the work is interrupted
		await Effect.runPromise(Fiber.interrupt(fiber));

		// THEN the interruption returned only after the work had settled
		expect(settled).toBe(true);
	});

	it("should keep the work's error message and add the code and fix", async () => {
		// GIVEN work that fails
		const work = attempt(
			() => Promise.reject(new Error("HTTP 503")),
			failWith("provider", "Try again later."),
		);

		// WHEN it runs
		const error = await Effect.runPromise(Effect.flip(work));

		// THEN the failure says what happened and what to do
		expect(error.code).toBe("provider");
		expect(error.message).toBe("HTTP 503");
		expect(error.fix).toBe("Try again later.");
	});

	it("should return what the work returns", async () => {
		// GIVEN work that succeeds
		const work = attempt(() => Promise.resolve(42), failWith("failed", "unused"));

		// WHEN it runs
		// THEN its value comes back
		expect(await Effect.runPromise(work)).toBe(42);
	});
});
