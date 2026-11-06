/**
 * Runs promise-based work as an Effect. When the Effect is interrupted (Ctrl-C, or an MCP
 * client cancelling), the AbortSignal fires and stops fetches and child processes.
 *
 * On interruption we wait, up to a limit, for the work to stop. That way a child process is
 * gone before the cleanup steps run. Otherwise ffmpeg, still finishing its file after SIGTERM,
 * could recreate a temporary file that cleanup had just removed.
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

/** The common case: keep the original error's message, and add the code and the fix. */
export const failWith =
	(code: ErrorCode, fix: string) =>
	(error: unknown): ShortsError =>
		fail(code, error instanceof Error ? error.message : String(error), fix);
