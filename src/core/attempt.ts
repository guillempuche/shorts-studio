/**
 * Bridges promise-based work into Effect. The AbortSignal fires when the Effect is interrupted
 * (Ctrl-C, or an MCP client cancelling), which stops fetches and child processes.
 */

import { Effect } from "effect";
import { type ErrorCode, fail, type ShortsError } from "./errors.ts";

export const attempt = <A>(
	work: (signal: AbortSignal) => Promise<A>,
	onError: (error: unknown) => ShortsError,
): Effect.Effect<A, ShortsError> => Effect.tryPromise({ try: work, catch: onError });

/** The common case: keep the underlying message, add the code and the fix. */
export const failWith =
	(code: ErrorCode, fix: string) =>
	(error: unknown): ShortsError =>
		fail(code, error instanceof Error ? error.message : String(error), fix);
