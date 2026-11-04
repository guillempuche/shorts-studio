/**
 * The one error type operations fail with.
 *
 * Every failure names what went wrong (`message`) and what to do about it (`fix`), because the
 * reader is as often an agent as a person, and an agent with no next step retries blindly. The
 * `code` is stable and documented; it decides the exit code and is what scripts should match on.
 */

import { Runtime, Schema } from "effect";

export const ErrorCode = Schema.Literals([
	"failed",
	"usage",
	"needs-confirmation",
	"over-budget",
	"not-found",
	"conflict",
	"stale",
	"missing-tool",
	"missing-key",
	"provider",
]);
export type ErrorCode = typeof ErrorCode.Type;

/** Process exit code per error code; see docs/architecture.md#exit-codes. */
export const exitCodeOf = (code: ErrorCode): number => {
	switch (code) {
		case "usage":
			return 2;
		case "needs-confirmation":
			return 3;
		case "over-budget":
			return 4;
		default:
			return 1;
	}
};

export class ShortsError extends Schema.TaggedError<ShortsError>()("ShortsError", {
	code: ErrorCode,
	message: Schema.String,
	fix: Schema.String,
}) {
	override get [Runtime.errorExitCode](): number {
		return exitCodeOf(this.code);
	}
	// The CLI prints every ShortsError itself (as text or JSON), so the runtime must not
	// log it a second time.
	override readonly [Runtime.errorReported] = false;
}

export const fail = (code: ErrorCode, message: string, fix: string): ShortsError =>
	new ShortsError({ code, message, fix });
