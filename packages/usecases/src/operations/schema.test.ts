import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { run, runFailure, testContext } from "../testing.ts";
import { operations } from "./index.ts";
import { makeSchemaShow, postSchemaFile } from "./schema.ts";

const MODE = { dryRun: false, confirmed: true } as const;
const schemaShow = makeSchemaShow(() => operations);

/** The repository's schemas/post.schema.json, found from here however deep this file sits. */
const committedSchemaFile = (from = import.meta.dirname): string => {
	const file = join(from, "schemas", "post.schema.json");
	if (existsSync(file)) return file;
	const parent = dirname(from);
	if (parent === from) throw new Error("schemas/post.schema.json not found above this test");
	return committedSchemaFile(parent);
};

describe("postSchemaFile", () => {
	it("should match the committed schemas/post.schema.json", () => {
		// GIVEN the schema file that each post.json points at
		const committed = JSON.parse(readFileSync(committedSchemaFile(), "utf8"));

		// WHEN a fresh one is made from the Post Schema
		// THEN they match (if not, run: pnpm schemas)
		expect(committed).toEqual(postSchemaFile());
	});
});

describe("schema show", () => {
	it("should list post and every command's name when no name is given", async () => {
		// GIVEN the registry
		// WHEN schema show runs without a name
		const result = await run(schemaShow.run({ name: undefined }, testContext(), MODE));

		// THEN it lists post, then each operation
		expect(result.names).toEqual(["post", ...operations.map((op) => op.name)]);
	});

	it("should show a command's input and output schemas", async () => {
		// GIVEN the registry
		// WHEN the schema of image_generate is shown
		const result = await run(schemaShow.run({ name: "image_generate" }, testContext(), MODE));

		// THEN its input lists the command's parameters, with dryRun since it spends
		const schema = result.schema as { input: { properties: object }; output: object };
		expect(Object.keys(schema.input.properties).sort()).toEqual(
			["beat", "dryRun", "model", "post", "reroll"].sort(),
		);
		expect(schema.output).toBeDefined();
	});

	it("should say how to list the names when a name is unknown", async () => {
		// GIVEN the registry
		// WHEN an unknown schema is asked for
		const error = await runFailure(schemaShow.run({ name: "nope" }, testContext(), MODE));

		// THEN it is not found, and the fix lists the names
		expect(error.code).toBe("not-found");
		expect(error.fix).toContain("schema show");
	});
});
