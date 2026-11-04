/**
 * The operation registry: each operation is declared once and exposed twice, as a CLI command
 * (`post create --post x`) and as an MCP tool (`post_create { post: "x" }`).
 *
 * A parameter is declared with `p.*`, which yields both its Effect Schema (the MCP tool's input
 * schema and the `schema` command's output) and its CLI flag, so the two surfaces can't drift.
 * Every input is a flag, never a positional argument: one shape for people and agents alike.
 */

import { type Effect, Option, Schema } from "effect";
import { Flag } from "effect/cli";
import type { Context } from "./context.ts";
import type { ShortsError } from "./errors.ts";

export interface Param<A> {
	readonly description: string;
	/** The field in the MCP tool's input Schema. */
	readonly field: Schema.Top;
	/** The CLI flag; its name is set when the operation is built, from the parameter's key. */
	readonly flag: (flagName: string) => Flag.Flag<A>;
	/** Fills MCP input the way the CLI flag would (absent boolean → false). */
	readonly normalize: (value: unknown) => A;
}

export type Params = Readonly<Record<string, Param<unknown>>>;
export type InputOf<P extends Params> = {
	readonly [K in keyof P]: P[K] extends Param<infer A> ? A : never;
};

const described = <A>(flag: Flag.Flag<A>, description: string): Flag.Flag<A> =>
	flag.pipe(Flag.withDescription(description));

export const p = {
	string: (description: string): Param<string> => ({
		description,
		field: Schema.String.annotate({ description }),
		flag: (name) => described(Flag.String(name), description),
		normalize: (value) => value as string,
	}),
	int: (description: string): Param<number> => ({
		description,
		field: Schema.Int.annotate({ description }),
		flag: (name) => described(Flag.Int(name), description),
		normalize: (value) => value as number,
	}),
	boolean: (description: string): Param<boolean> => ({
		description,
		field: Schema.optionalKey(Schema.Boolean.annotate({ description })),
		flag: (name) => described(Flag.Boolean(name), description).pipe(Flag.withDefault(false)),
		normalize: (value) => value === true,
	}),
	literals: <const L extends ReadonlyArray<string>>(
		values: L,
		description: string,
	): Param<L[number]> => ({
		description,
		field: Schema.Literals(values).annotate({ description }),
		flag: (name) => described(Flag.Literals(name, values), description),
		normalize: (value) => value as L[number],
	}),
	optional: <A>(param: Param<A>): Param<A | undefined> => ({
		description: param.description,
		field: Schema.optionalKey(param.field as Schema.Constraint),
		flag: (name) => param.flag(name).pipe(Flag.optional, Flag.map(Option.getOrUndefined)),
		normalize: (value) => (value === undefined ? undefined : param.normalize(value)),
	}),
};

/** How a run was asked for: the CLI's `--dry-run` / `--yes`, or an MCP call. */
export interface RunMode {
	/** Describe what would happen (files, estimated cost) and change nothing. */
	readonly dryRun: boolean;
	/** Spending is confirmed. Always true over MCP, where the client's approval is the gate. */
	readonly confirmed: boolean;
}

export interface Operation<P extends Params = Params, O = unknown> {
	/** `noun_verb`: the MCP tool name; the CLI command is the same words, `noun verb`. */
	readonly name: string;
	readonly description: string;
	readonly params: P;
	/** A Struct, because MCP requires an object root for tool results. */
	readonly output: Schema.Codec<O, unknown>;
	/** Decisions that belong to the user (approving a script or a draft) stay off MCP. */
	readonly surface: "cli-and-mcp" | "cli-only";
	/** Spends money: needs `--yes` on the CLI and supports `--dry-run` everywhere. */
	readonly spends: boolean;
	readonly hints: {
		readonly readonly: boolean;
		readonly destructive: boolean;
		readonly idempotent: boolean;
		/** Reaches services outside this machine. */
		readonly openWorld: boolean;
	};
	readonly run: (input: InputOf<P>, ctx: Context, mode: RunMode) => Effect.Effect<O, ShortsError>;
	/** Human-readable output; JSON is printed when absent or with `--json`. */
	readonly render?: (output: O) => string;
}

export const defineOperation = <P extends Params, O>(op: Operation<P, O>): Operation<P, O> => op;

/** `inStage` → `in-stage`. */
export const flagName = (key: string): string =>
	key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** `post_create` → `["post", "create"]`. */
export const commandPath = (name: string): readonly [string, string] => {
	const [noun, verb] = name.split("_");
	if (noun === undefined || verb === undefined) throw new Error(`Bad operation name: ${name}`);
	return [noun, verb];
};

export const toolInputSchema = (op: Operation): Schema.Top => {
	const fields: Record<string, Schema.Top> = {};
	for (const [key, param] of Object.entries(op.params)) fields[key] = param.field;
	if (op.spends) {
		fields["dryRun"] = Schema.optionalKey(
			Schema.Boolean.annotate({
				description: "Describe the files and estimated cost without spending anything",
			}),
		);
	}
	return Schema.Struct(fields as Schema.Struct.Fields);
};
