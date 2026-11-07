/**
 * The one error type commands fail with, and the reasons it can carry.
 *
 * Every failure says what went wrong (`message`) and what to do about it (`fix`). The reader is
 * often an agent, and an agent with no next step retries blindly. The `reason` is a tagged
 * error, so code can handle one kind with `Effect.catchReason("ShortsError", "NotFound", …)`.
 * Its `code` is stable and documented: it sets the exit code, and it's what scripts match on.
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

const said = { message: Schema.String, fix: Schema.String };

export class Failed extends Schema.TaggedError<Failed>()("Failed", said) {}
export class Usage extends Schema.TaggedError<Usage>()("Usage", said) {}
export class NeedsConfirmation extends Schema.TaggedError<NeedsConfirmation>()(
	"NeedsConfirmation",
	said,
) {}
export class OverBudget extends Schema.TaggedError<OverBudget>()("OverBudget", said) {}
export class NotFound extends Schema.TaggedError<NotFound>()("NotFound", said) {}
export class Conflict extends Schema.TaggedError<Conflict>()("Conflict", said) {}
export class Stale extends Schema.TaggedError<Stale>()("Stale", said) {}
export class MissingTool extends Schema.TaggedError<MissingTool>()("MissingTool", said) {}
export class MissingKey extends Schema.TaggedError<MissingKey>()("MissingKey", said) {}
/** The provider's answer is unknown or unusable: a 5xx, a dropped connection, a bad reply. */
export class ProviderFailed extends Schema.TaggedError<ProviderFailed>()("ProviderFailed", said) {}
/** The provider answered no, with an HTTP 4xx: it took nothing on, so it billed nothing. */
export class Refused extends Schema.TaggedError<Refused>()("Refused", said) {}
/** The provider gave up on a request: waiting for it again never succeeds. */
export class RequestEnded extends Schema.TaggedError<RequestEnded>()("RequestEnded", said) {}

export const Reason = Schema.Union([
	Failed,
	Usage,
	NeedsConfirmation,
	OverBudget,
	NotFound,
	Conflict,
	Stale,
	MissingTool,
	MissingKey,
	ProviderFailed,
	Refused,
	RequestEnded,
]);
export type Reason = typeof Reason.Type;

const CODE: Readonly<Record<Reason["_tag"], ErrorCode>> = {
	Failed: "failed",
	Usage: "usage",
	NeedsConfirmation: "needs-confirmation",
	OverBudget: "over-budget",
	NotFound: "not-found",
	Conflict: "conflict",
	Stale: "stale",
	MissingTool: "missing-tool",
	MissingKey: "missing-key",
	ProviderFailed: "provider",
	Refused: "provider",
	RequestEnded: "provider",
};

type Said = { readonly message: string; readonly fix: string };

const REASON: Readonly<Record<ErrorCode, (said: Said) => Reason>> = {
	failed: (s) => new Failed(s),
	usage: (s) => new Usage(s),
	"needs-confirmation": (s) => new NeedsConfirmation(s),
	"over-budget": (s) => new OverBudget(s),
	"not-found": (s) => new NotFound(s),
	conflict: (s) => new Conflict(s),
	stale: (s) => new Stale(s),
	"missing-tool": (s) => new MissingTool(s),
	"missing-key": (s) => new MissingKey(s),
	provider: (s) => new ProviderFailed(s),
};

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
	reason: Reason,
	message: Schema.String,
	fix: Schema.String,
}) {
	get code(): ErrorCode {
		return CODE[this.reason._tag];
	}
	override get [Runtime.errorExitCode](): number {
		return exitCodeOf(this.code);
	}
	// The CLI prints every ShortsError itself (as text or JSON), so the runtime must not
	// print it a second time.
	override readonly [Runtime.errorReported] = false;
}

/** A ShortsError around a reason, with the reason's message and fix copied to the top. */
export const failBecause = (reason: Reason): ShortsError =>
	new ShortsError({ reason, message: reason.message, fix: reason.fix });

export const fail = (code: ErrorCode, message: string, fix: string): ShortsError =>
	failBecause(REASON[code]({ message, fix }));

/** The documented error shape: what `--json` prints and what an MCP tool returns. */
export const ErrorReport = Schema.Struct({
	code: ErrorCode,
	message: Schema.String,
	fix: Schema.String,
});

export const reportOf = (error: ShortsError): typeof ErrorReport.Type => ({
	code: error.code,
	message: error.message,
	fix: error.fix,
});
