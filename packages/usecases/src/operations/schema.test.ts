import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { testContext } from "../test/context.ts";
import { run, runFailure } from "../test/fakes.ts";
import { operations } from "./index.ts";
import { FILE_SCHEMAS, fileSchema, makeSchemaShow } from "./schema.ts";

const MODE = { dryRun: false, confirmed: true } as const;
const schemaShow = makeSchemaShow(() => operations);

/** The repository's schemas/<name>.schema.json, found from here however deep this file sits. */
const committedSchemaFile = (name: string, from = import.meta.dirname): string => {
	const file = join(from, "schemas", `${name}.schema.json`);
	if (existsSync(file)) return file;
	const parent = dirname(from);
	if (parent === from) throw new Error(`schemas/${name}.schema.json not found above this test`);
	return committedSchemaFile(name, parent);
};

describe("fileSchema", () => {
	it.each(Object.keys(FILE_SCHEMAS) as Array<keyof typeof FILE_SCHEMAS>)(
		"should match the committed schemas/%s.schema.json",
		(name) => {
			// GIVEN the schema file that this kind of file points at
			const committed = JSON.parse(readFileSync(committedSchemaFile(name), "utf8"));

			// WHEN a fresh one is made from its Effect Schema
			// THEN they match (if not, run: pnpm schemas)
			expect(committed).toEqual(fileSchema(name));
		},
	);
});

describe("schema show", () => {
	it("should list the three files and every command's name when no name is given", async () => {
		// GIVEN the registry
		// WHEN schema show runs without a name
		const result = await run(schemaShow.run({ name: undefined }, testContext(), MODE));

		// THEN it lists post, config and brand, then each operation
		expect(result.names).toEqual(["post", "config", "brand", ...operations.map((op) => op.name)]);
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

describe("schema show, by either name", () => {
	it.each(["image generate", "image-generate"])(
		"should read %s as the tool image_generate",
		async (name) => {
			// GIVEN the registry
			// WHEN a command's schema is asked for as the CLI writes it
			const [asCli, asTool] = await Promise.all([
				run(schemaShow.run({ name }, testContext(), MODE)),
				run(schemaShow.run({ name: "image_generate" }, testContext(), MODE)),
			]);

			// THEN it is the tool's schema
			expect(asCli.schema).toEqual(asTool.schema);
		},
	);

	it("should mark the commands that aren't MCP tools", async () => {
		// GIVEN the registry
		// WHEN the names are listed
		const result = await run(schemaShow.run({ name: undefined }, testContext(), MODE));

		// THEN the user's approvals are CLI only, and the shared commands aren't
		expect(result.cliOnly).toContain("script_approve");
		expect(result.cliOnly).toContain("post_review");
		expect(result.cliOnly).not.toContain("post_show");
		// AND the text marks them
		expect(schemaShow.render?.(result)).toContain("script_approve (CLI only)");
	});
});

describe("schema show, closed inputs", () => {
	it("should publish a command's input, and each beat in it, as taking no other field", async () => {
		// GIVEN the registry
		// WHEN beat_set's schema is shown
		const result = await run(schemaShow.run({ name: "beat_set" }, testContext(), MODE));

		// THEN its input takes no other field
		type Node = { additionalProperties?: unknown; items?: Node; anyOf?: ReadonlyArray<Node> };
		const { input } = result.schema as {
			input: { additionalProperties?: unknown; properties: { beats: Node } };
		};
		expect(input.additionalProperties).toBe(false);
		// AND neither does each item of beats, given as a list
		const list = input.properties.beats.anyOf?.find((branch) => branch.items !== undefined);
		expect(list?.items?.additionalProperties).toBe(false);
	});

	it("should leave the post file's schema as it is", async () => {
		// GIVEN the registry
		// WHEN the post's schema is shown
		const result = await run(schemaShow.run({ name: "post" }, testContext(), MODE));

		// THEN it is the committed file schema, which stays open
		expect(result.schema).toEqual(fileSchema("post"));
	});
});
