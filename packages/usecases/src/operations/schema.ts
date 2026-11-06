/**
 * `schema show`: JSON Schemas generated from the same Effect Schemas the code uses, for agents
 * without MCP and for editors (each post.json points at schemas/post.schema.json).
 */

import { fail } from "@shorts-studio/domain/errors";
import { Post } from "@shorts-studio/domain/post";
import { Effect, JsonSchema, Schema } from "effect";
import { defineOperation, type Operation, p, toolInputSchema } from "../operation.ts";

/** A standalone draft 2020-12 JSON Schema file for one Effect Schema. */
export const toJsonSchemaFile = (schema: Schema.Top): Record<string, unknown> => {
	const document = Schema.toJsonSchemaDocument(schema);
	return {
		$schema: JsonSchema.META_SCHEMA_URI_DRAFT_2020_12,
		...document.schema,
		...(Object.keys(document.definitions).length > 0 ? { $defs: document.definitions } : {}),
	};
};

export const postSchemaFile = (): Record<string, unknown> => toJsonSchemaFile(Post);

/** Takes the operation list as a function because that list includes this operation. */
export const makeSchemaShow = (operations: () => ReadonlyArray<Operation>) =>
	defineOperation({
		name: "schema_show",
		description:
			'Show the JSON Schema of post.json (name "post") or of one command\'s input and output (e.g. "image_generate"). Without a name, list the names.',
		params: { name: p.optional(p.string('"post" or a command name such as image_generate')) },
		output: Schema.Struct({
			names: Schema.optionalKey(Schema.Array(Schema.String)),
			schema: Schema.optionalKey(Schema.Unknown),
		}),
		surface: "cli-and-mcp",
		spends: false,
		hints: { readonly: true, destructive: false, idempotent: true, openWorld: false },
		run: (input) =>
			Effect.gen(function* () {
				const ops = operations();
				if (input.name === undefined) return { names: ["post", ...ops.map((op) => op.name)] };
				if (input.name === "post") return { schema: postSchemaFile() };
				const op = ops.find((candidate) => candidate.name === input.name);
				if (op === undefined) {
					return yield* fail(
						"not-found",
						`No schema named "${input.name}".`,
						"List the names with: schema show",
					);
				}
				return {
					schema: {
						input: toJsonSchemaFile(toolInputSchema(op)),
						output: toJsonSchemaFile(op.output),
					},
				};
			}),
		render: (o) => (o.names ? o.names.join("\n") : JSON.stringify(o.schema, null, 2)),
	});
