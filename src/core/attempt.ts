/**
 * Bridges promise-based work into Effect. The AbortSignal fires when the Effect is interrupted
 * (Ctrl-C, or an MCP client cancelling), which stops fetches and child processes.
 *
 * Interruption waits for the work to finish stopping (bounded), so a child process is gone
 * before finalisers run: otherwise ffmpeg, still writing its trailer after SIGTERM, could
 * recreate a temporary file that cleanup had just removed.
 */

import { Effect } from "effect";
import { type ErrorCode, fail, type ShortsError } from "./errors.ts";

/** Longer than a child process gets between SIGTERM and SIGKILL (process.ts). */
const STOP_WAIT_MS = 10_000;

export const attempt = <A>(
	work: (signal: AbortSignal) => Promise<A>,
	onError: (error: unknown) => ShortsError,
): Effect.Effect<A, ShortsError> =>
	Effect.callback<A, ShortsError>((resume, signal) => {
		const settled = work(signal).then(
			(value) => resume(Effect.succeed(value)),
			(error: unknown) => resume(Effect.fail(onError(error))),
		);
		return Effect.promise(() => settled).pipe(Effect.timeout(STOP_WAIT_MS), Effect.ignore);
	});

/** The common case: keep the underlying message, add the code and the fix. */
export const failWith =
	(code: ErrorCode, fix: string) =>
	(error: unknown): ShortsError =>
		fail(code, error instanceof Error ? error.message : String(error), fix);
