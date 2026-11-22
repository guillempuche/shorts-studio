import { schemaIssues } from "@shorts-studio/domain/errors";
import { Effect, Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { closedStruct, defineOperation, p, toolInputSchema } from "./operation.ts";
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

describe("closedStruct", () => {
	const Item = closedStruct(
		{ beat: Schema.Int, prompt: Schema.optionalKey(Schema.String) },
		"An item",
	);

	it("should take the fields it has", () => {
		// GIVEN an item with only its own fields
		// WHEN it is decoded
		const item = Schema.decodeUnknownSync(Item)({ beat: 0, prompt: "a door" });

		// THEN it is kept as it is
		expect(item).toEqual({ beat: 0, prompt: "a door" });
	});

	it("should refuse a field it doesn't have, naming the fields it takes", () => {
		// GIVEN an item with a misspelt field
		// WHEN it is decoded
		const result = Schema.decodeUnknownResult(Item)({ beat: 0, promt: "a door" });

		// THEN it fails at that field, listing the fields an item takes
		expect(Result.isFailure(result)).toBe(true);
		const issues = Result.isFailure(result) ? schemaIssues(result.failure) : [];
		expect(issues).toEqual([
			{ path: ["promt"], message: "An item doesn't take this field. It takes: beat, prompt" },
		]);
	});
});

describe("p.json", () => {
	const list = Schema.Array(
		closedStruct({ beat: Schema.Int, prompt: Schema.optionalKey(Schema.String) }, "An item"),
	);
	const op = defineOperation({
		name: "test_list",
		description: "Takes a list",
		params: { items: p.json(list, "The items") },
		output: Schema.Struct({}),
		surface: "cli-and-mcp",
		spends: false,
		hints: { readonly: true, destructive: false, idempotent: true, openWorld: false },
		run: () => Effect.succeed({}),
	});

	it("should take the list itself as the tool's field", () => {
		// GIVEN a tool call with a list, as an MCP client sends it
		// WHEN its input is decoded
		const input = Schema.decodeUnknownSync(toolInputSchema(op))({ items: [{ beat: 0 }] });

		// THEN the list arrives as it was sent
		expect(input).toEqual({ items: [{ beat: 0 }] });
	});

	it("should refuse a field an item doesn't take, naming it", () => {
		// GIVEN a tool call whose item has a misspelt field
		// WHEN its input is decoded
		const result = Schema.decodeUnknownResult(toolInputSchema(op))({
			items: [{ beat: 0, promt: "x" }],
		});

		// THEN it fails at that field of that item
		const issues = Result.isFailure(result) ? schemaIssues(result.failure) : [];
		expect(issues.map((issue) => issue.path)).toEqual([["items", "0", "promt"]]);
	});
});
