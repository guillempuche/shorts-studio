import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { defineOperation } from "./operation.ts";
import { testContext } from "./test/context.ts";
import { runFailure } from "./test/fakes.ts";

describe("defineOperation", () => {
	it("should turn a step that throws into a failure with a fix", async () => {
		// GIVEN an operation one of whose steps throws, as a full disk makes a sync write do
		const op = defineOperation({
			name: "test_throw",
			description: "Throws",
			params: {},
			output: Schema.Struct({}),
			surface: "cli-and-mcp",
			spends: false,
			hints: { readonly: true, destructive: false, idempotent: true, openWorld: false },
			run: () =>
				Effect.sync(() => {
					throw new Error("ENOSPC: no space left on device, write");
				}),
		});

		// WHEN it runs
		const logged: Array<string> = [];
		const ctx = testContext({ log: (line) => logged.push(line) });
		const error = await runFailure(op.run({}, ctx, { dryRun: false, confirmed: true }));

		// THEN it fails as a ShortsError that keeps what went wrong and says what to do
		expect(error.code).toBe("failed");
		expect(error.message).toContain("ENOSPC");
		expect(error.fix).toContain("check it exists and can be written");
		// AND the trace goes to the log, so a bug report can say where it came from
		expect(logged.join("\n")).toContain("operation.test.ts");
	});
});
