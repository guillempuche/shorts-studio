import { Cause, Effect, Exit, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it, vi } from "vitest";
import { attempt, failWith } from "./attempt.ts";

describe("attempt", () => {
	it("should finish an interruption only once the abandoned work has settled", async () => {
		// GIVEN work that has started and takes 300 ms to wind down after it's told to stop
		let started = false;
		let settled = false;
		const work = attempt(
			(signal) =>
				new Promise<void>((resolve) => {
					started = true;
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
		await vi.waitUntil(() => started);

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

	it("should end, as a defect, when turning the work's error into a failure throws", async () => {
		// GIVEN work that fails, and an error mapper with a bug
		const work = attempt(
			() => Promise.reject(new Error("HTTP 503")),
			() => {
				throw new Error("mapper bug");
			},
		);

		// WHEN it runs
		const exit = await Effect.runPromiseExit(work);

		// THEN it ends instead of waiting forever, and the bug is what it ends with
		expect(Exit.isFailure(exit) && Cause.hasDies(exit.cause)).toBe(true);
	});

	it("should stop waiting for abandoned work that never settles, after its limit", async () => {
		// GIVEN work that never settles, even once it's told to stop
		let aborted = false;
		const work = attempt(
			(signal) =>
				new Promise<void>(() => {
					signal.addEventListener("abort", () => {
						aborted = true;
					});
				}),
			failWith("failed", "unused"),
		);

		// WHEN it's interrupted, and the 10 s limit passes
		const stopped = await Effect.runPromise(
			Effect.gen(function* () {
				const fiber = yield* Effect.forkChild(work);
				yield* Effect.yieldNow;
				const stopping = yield* Effect.forkChild(Fiber.interrupt(fiber));
				yield* Effect.yieldNow;
				const beforeLimit = stopping.pollUnsafe();
				yield* TestClock.adjust("10 seconds");
				yield* Fiber.join(stopping);
				return beforeLimit;
			}).pipe(Effect.provide(TestClock.layer())),
		);

		// THEN the work was told to stop, and the interruption waited for it until the limit
		expect(aborted).toBe(true);
		expect(stopped).toBeUndefined();
	});
});
