import { Effect, Fiber } from "effect";
import { describe, expect, it } from "vitest";
import { attempt, failWith } from "../src/core/attempt.ts";
import { runProcess } from "../src/core/process.ts";

describe("interrupting work that runs a child process", () => {
	it("should finish only after the child has stopped", async () => {
		// GIVEN a child that takes 400 ms to stop after SIGTERM, like ffmpeg writing its trailer
		let childExited = false;
		const slowToStop =
			"process.on('SIGTERM', () => setTimeout(() => process.exit(0), 400)); setInterval(() => {}, 1000);";
		const work = attempt(
			(signal) =>
				runProcess(process.execPath, ["-e", slowToStop], { signal }).then((result) => {
					childExited = true;
					return result;
				}),
			failWith("failed", "unused"),
		);
		const fiber = Effect.runFork(work);
		await new Promise((resolve) => setTimeout(resolve, 300));
		// WHEN the work is interrupted
		await Effect.runPromise(Fiber.interrupt(fiber));
		// THEN the interruption returned only once the child had exited
		expect(childExited).toBe(true);
	});
});
