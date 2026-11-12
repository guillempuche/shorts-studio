/**
 * The one error type commands fail with, and the reasons it can carry.
 *
 * Every failure says what went wrong (`message`) and what to do about it (`fix`). The reader is
 * often an agent, and an agent with no next step retries blindly. The `reason` is a tagged
 * error, so code can handle one kind with `Effect.catchReason("ShortsError", "NotFound", …)`.
 * Its `code` is stable and documented: it sets the exit code, and it's what scripts match on.
 */

import { Runtime, Schema, SchemaIssue } from "effect";

export const ErrorCode = Schema.Literals([
	"failed",
	"usage",
	"needs-confirmation",
	"needs-approval",
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
/** Check the estimate, then run it again with `--yes`: the agent may do that. */
export class NeedsConfirmation extends Schema.TaggedError<NeedsConfirmation>()(
	"NeedsConfirmation",
	said,
) {}
/** The step waits on the user's own decision (an approval): the agent stops and asks. */
export class NeedsApproval extends Schema.TaggedError<NeedsApproval>()("NeedsApproval", said) {}
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
	NeedsApproval,
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
	NeedsApproval: "needs-approval",
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

/**
 * The reason `fail` builds for each code. `provider` builds `ProviderFailed`, the outcome-unknown
 * reason that keeps a reservation counted: a refusal or an ended request needs `failBecause`.
 */
const REASON: Readonly<Record<ErrorCode, new (said: Said) => Reason>> = {
	failed: Failed,
	usage: Usage,
	"needs-confirmation": NeedsConfirmation,
	"needs-approval": NeedsApproval,
	"over-budget": OverBudget,
	"not-found": NotFound,
	conflict: Conflict,
	stale: Stale,
	"missing-tool": MissingTool,
	"missing-key": MissingKey,
	provider: ProviderFailed,
};

/** Process exit code per error code; see docs/architecture.md#exit-codes. */
export const exitCodeOf = (code: ErrorCode): number => {
	switch (code) {
		case "usage":
			return 2;
		case "needs-confirmation":
		case "needs-approval":
			return 3;
		case "over-budget":
			return 4;
		default:
			return 1;
	}
};

/** Its `message` and `fix` are read from its reason, so the two can't disagree. */
export class ShortsError extends Schema.TaggedError<ShortsError>()("ShortsError", {
	reason: Reason,
}) {
	override get message(): string {
		return this.reason.message;
	}
	get fix(): string {
		return this.reason.fix;
	}
	get code(): ErrorCode {
		return CODE[this.reason._tag];
	}
	override get [Runtime.errorExitCode](): number {
		return exitCodeOf(this.code);
	}
	// The CLI prints every ShortsError itself (as text or JSON), so the runtime must not
	// print it a second time. A getter, so it stays out of the error's JSON.
	override get [Runtime.errorReported](): boolean {
		return false;
	}
}

export const failBecause = (reason: Reason): ShortsError => new ShortsError({ reason });

export const fail = (code: ErrorCode, message: string, fix: string): ShortsError =>
	failBecause(new REASON[code]({ message, fix }));

const formatIssues = SchemaIssue.makeFormatterStandardSchemaV1();

/** What a Schema failure found wrong: each bad field's path, with what's wrong with it. */
export const schemaIssues = (
	error: Schema.SchemaError,
): ReadonlyArray<{ readonly path: ReadonlyArray<string>; readonly message: string }> =>
	formatIssues(error.issue).issues.map(({ path, message }) => ({
		path: (path ?? []).map((key) => String(typeof key === "object" ? key.key : key)),
		message,
	}));

/**
 * A Schema failure as one line for a `message`,
 * e.g. `caps.dailyUsd: Expected a value greater than or equal to 0, got -1`.
 */
export const issueLine = (error: Schema.SchemaError): string =>
	schemaIssues(error)
		.map(({ path, message }) => (path.length === 0 ? message : `${path.join(".")}: ${message}`))
		.join("; ");

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
