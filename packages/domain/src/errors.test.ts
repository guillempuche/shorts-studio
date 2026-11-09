import { Cause, Result, Runtime, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { ErrorCode, fail, failBecause, issueLine, RequestEnded, reportOf } from "./errors.ts";

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

		// THEN calling it wrong exits 2, needing confirmation 3, passing a cap 4
		expect(exitCode("usage")).toBe(2);
		expect(exitCode("needs-confirmation")).toBe(3);
		expect(exitCode("over-budget")).toBe(4);
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
});
