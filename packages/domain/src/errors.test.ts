import { Cause, Result, Runtime, Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
	ErrorCode,
	fail,
	failBecause,
	issueLine,
	NotSent,
	RequestEnded,
	reportOf,
} from "./errors.ts";

describe("fail", () => {
	it("should keep the code, the message and the fix", () => {
		// GIVEN a failure for a missing post
		// WHEN it is made
		const error = fail("not-found", "No post x.", "List posts with: post list");

		// THEN it carries all three
		expect(error.code).toBe("not-found");
		expect(error.message).toBe("No post x.");
		expect(error.fix).toBe("List posts with: post list");
	});

	it("should set the documented exit code for each kind of failure", () => {
		// GIVEN one failure of each code
		const exitCode = (code: typeof ErrorCode.Type) => fail(code, "m", "f")[Runtime.errorExitCode];

		// THEN calling it wrong exits 2, needing --yes or the user's approval 3, passing a cap 4,
		// and being interrupted 130, as a shell reports Ctrl-C
		expect(exitCode("usage")).toBe(2);
		expect(exitCode("needs-confirmation")).toBe(3);
		expect(exitCode("needs-approval")).toBe(3);
		expect(exitCode("over-budget")).toBe(4);
		expect(exitCode("interrupted")).toBe(130);
		// AND everything else exits 1
		expect(exitCode("not-found")).toBe(1);
		expect(exitCode("provider")).toBe(1);
	});

	it("should give back the code it was made with, for every code", () => {
		// GIVEN every documented code
		// WHEN a failure is made with each
		// THEN each reports the same code, so the two tables in errors.ts agree
		for (const code of ErrorCode.literals) expect(fail(code, "m", "f").code).toBe(code);
	});

	it("should show its message when printed, and keep the runtime's own report out of its JSON", () => {
		// GIVEN a failure
		const error = fail("not-found", "No post x.", "List posts with: post list");

		// WHEN it is printed, as the runtime would, and turned into JSON
		// THEN the printed form names the problem
		expect(Cause.pretty(Cause.fail(error))).toContain("No post x.");
		// AND the JSON holds only its fields
		expect(Object.keys(JSON.parse(JSON.stringify(error)))).not.toContain(
			String(Runtime.errorReported),
		);
	});
});

describe("issueLine", () => {
	it("should name each bad field by its path, on one line", () => {
		// GIVEN a settings object with a negative cap and a cap that isn't a number
		const Caps = Schema.Struct({
			caps: Schema.Struct({
				dailyUsd: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
				postUsd: Schema.Finite,
			}),
		});
		const result = Schema.decodeUnknownResult(Caps, { errors: "all" })({
			caps: { dailyUsd: -1, postUsd: "lots" },
		});

		// WHEN its failure is put in words
		const line = Result.isFailure(result) ? issueLine(result.failure) : "";

		// THEN both fields are named, and nothing breaks the line
		expect(line).toContain("caps.dailyUsd: ");
		expect(line).toContain("caps.postUsd: ");
		expect(line).not.toContain("\n");
	});
});

describe("failBecause", () => {
	it("should report a provider that ended a request as a provider failure", () => {
		// GIVEN a provider that gave up on a request
		const reason = new RequestEnded({
			message: "Request req-1 failed.",
			fix: "Submit a new request.",
		});

		// WHEN it becomes a failure
		const error = failBecause(reason);

		// THEN scripts see the provider code, and code can still tell the reason apart
		expect(error.code).toBe("provider");
		expect(error.reason._tag).toBe("RequestEnded");
		// AND the reason's message and fix are the failure's
		expect(error.message).toBe("Request req-1 failed.");
		expect(error.fix).toBe("Submit a new request.");
	});

	it("should report a request that never left the machine as a provider failure, exiting 1", () => {
		// GIVEN a request whose connection was refused before it was sent
		const reason = new NotSent({
			message: "connect ECONNREFUSED 127.0.0.1:9",
			fix: "Nothing was sent, so nothing was counted.",
		});

		// WHEN it becomes a failure
		const error = failBecause(reason);

		// THEN scripts see the provider code and exit 1, as for any provider failure
		expect(error.code).toBe("provider");
		expect(error[Runtime.errorExitCode]).toBe(1);
		// AND code can still tell it apart from an unknown outcome
		expect(error.reason._tag).toBe("NotSent");
	});
});

describe("reportOf", () => {
	it("should give the documented code, message and fix and nothing else", () => {
		// GIVEN a failure
		const error = fail("over-budget", "Too much.", "Raise the cap.");

		// WHEN it is reported
		// THEN the report holds exactly the three documented fields
		expect(reportOf(error)).toEqual({
			code: "over-budget",
			message: "Too much.",
			fix: "Raise the cap.",
		});
	});

	it("should carry the steps its fix names, as data", () => {
		// GIVEN a failure whose fix names a step
		const step = { by: "agent", cli: "post list", tool: "post_list", args: {} } as const;
		const error = fail("not-found", "No post x.", "List posts with: post list", [step]);

		// WHEN it is reported
		// THEN the report holds the step after the three fields
		expect(reportOf(error)).toEqual({
			code: "not-found",
			message: "No post x.",
			fix: "List posts with: post list",
			nextSteps: [step],
		});
		// AND the error itself gives them
		expect(error.nextSteps).toEqual([step]);
	});

	it("should leave out nextSteps when there are none", () => {
		// GIVEN failures made with no steps and with an empty list
		const reports = [
			reportOf(fail("failed", "Broke.", "Run it again.")),
			reportOf(fail("failed", "Broke.", "Run it again.", [])),
		];

		// THEN neither report has the key
		for (const report of reports) expect(Object.keys(report)).not.toContain("nextSteps");
	});
});
