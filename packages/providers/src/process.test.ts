import { attempt, failWith } from "@shorts-studio/usecases/attempt";
import { Effect, Fiber } from "effect";
import { describe, expect, it } from "vitest";
import { runProcess, stopWhenAborted } from "./process.ts";

/** Runs a short Node script as the child process. */
const node = (script: string, signal?: AbortSignal) =>
	runProcess(process.execPath, ["-e", script], signal === undefined ? {} : { signal });

describe("runProcess", () => {
	it("should collect what the program prints and its exit code", async () => {
		// GIVEN a program that writes to both streams and exits 3
		const script = "process.stdout.write('out'); process.stderr.write('err'); process.exit(3);";

		// WHEN it runs
		const result = await node(script);

		// THEN everything it printed and its exit code come back
		expect(result).toEqual({ code: 3, stdout: "out", stderr: "err" });
	});

	it("should reject when the program can't start", async () => {
		// GIVEN a program that isn't installed
		// WHEN it is run
		// THEN the run rejects instead of reporting an exit code
		await expect(runProcess("shorts-studio-no-such-program", [])).rejects.toThrow();
	});
});

describe("interrupting work that runs a child process", () => {
	it("should finish only after the child has stopped", async () => {
		// GIVEN a child that takes 400 ms to stop after SIGTERM, like ffmpeg writing its trailer
		let childExited = false;
		const slowToStop =
			"process.on('SIGTERM', () => setTimeout(() => process.exit(0), 400)); setInterval(() => {}, 1000);";
		const work = attempt(
			(signal) =>
				node(slowToStop, signal).then((result) => {
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

describe("stopWhenAborted", () => {
	it("should ask a process to stop, then force it when it doesn't", async () => {
		// GIVEN a process that ignores SIGTERM, watched with a 20 ms grace period
		const signals: Array<NodeJS.Signals> = [];
		const proc = { kill: (signal: NodeJS.Signals) => signals.push(signal) > 0 };
		const controller = new AbortController();
		stopWhenAborted(proc, controller.signal, 20);

		// WHEN its work is abandoned
		controller.abort();
		await new Promise((resolve) => setTimeout(resolve, 60));

		// THEN it was sent SIGTERM, then SIGKILL
		// (the signals sent are what this function is for)
		expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
	});

	it("should send nothing once the process has ended on its own", async () => {
		// GIVEN a watched process that ended before its work was abandoned
		const signals: Array<NodeJS.Signals> = [];
		const proc = { kill: (signal: NodeJS.Signals) => signals.push(signal) > 0 };
		const controller = new AbortController();
		const ended = stopWhenAborted(proc, controller.signal, 20);
		ended();

		// WHEN the work is abandoned afterwards
		controller.abort();
		await new Promise((resolve) => setTimeout(resolve, 60));

		// THEN no signal was sent
		expect(signals).toEqual([]);
	});
});
