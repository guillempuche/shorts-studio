/**
 * The operation registry. Each operation is declared once and offered twice: as a CLI command
 * (`post create --post x`) and as an MCP tool (`post_create { post: "x" }`).
 *
 * Declare a parameter with `p.*`. That gives both its Effect Schema (for the MCP tool's input
 * and the `schema` command's output) and its CLI flag, so the CLI and MCP can't drift apart.
 * Every input is a flag, never a positional argument, so people and agents use the same shape.
 */

import type { ShortsError } from "@shorts-studio/domain/errors";
import { Effect, Option, Schema } from "effect";
import { Flag } from "effect/cli";
import { failWith } from "./attempt.ts";
import type { Context } from "./context.ts";
import type { Ports } from "./ports.ts";

export interface Param<A> {
	readonly description: string;
	/** The field in the MCP tool's input Schema. */
	readonly field: Schema.Top;
	/** The CLI flag; its name is set when the operation is built, from the parameter's key. */
	readonly flag: (flagName: string) => Flag.Flag<A>;
	/** Fills in MCP input the way the CLI flag would (a missing boolean becomes false). */
	readonly normalize: (value: unknown) => A;
	/** Set by `p.optional`. */
	readonly optional?: true;
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
		optional: true,
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
	/** A Struct, because MCP requires a tool's result to be an object. */
	readonly output: Schema.Codec<O, unknown>;
	/** Decisions that belong to the user (approving a script or a draft) stay off MCP. */
	readonly surface: "cli-and-mcp" | "cli-only";
	/** Spends money: supports `--dry-run` everywhere, and needs `--yes` on the CLI. */
	readonly spends: boolean;
	/**
	 * False for a paid step that runs without `--yes`: transcription costs under a cent a post
	 * and runs before there is a script to approve. It still takes a dry run.
	 */
	readonly needsYes?: false;
	readonly hints: {
		readonly readonly: boolean;
		readonly destructive: boolean;
		readonly idempotent: boolean;
		/** Reaches services outside this machine. */
		readonly openWorld: boolean;
	};
	// Declared as methods: TypeScript checks method parameters more loosely (bivariantly), so a
	// specific operation fits the registry's `Operation` without a cast.
	run(input: InputOf<P>, ctx: Context, mode: RunMode): Effect.Effect<O, ShortsError, Ports>;
	/** Human-readable output; JSON is printed when absent or with `--json`. */
	render?(output: O): string;
}

/**
 * Registers an operation. A step that throws instead of failing (a defect) still reaches the user
 * as a ShortsError with a fix, so `--json` prints its one object and MCP its error, whatever broke.
 */
export const defineOperation = <P extends Params, O>(op: Operation<P, O>): Operation<P, O> => ({
	...op,
	run: (input, ctx, mode) =>
		op.run(input, ctx, mode).pipe(
			Effect.catchDefect((defect) =>
				// The whole trace goes to stderr first, so a bug report can say where it came from.
				Effect.sync(() =>
					ctx.log(defect instanceof Error ? (defect.stack ?? defect.message) : String(defect)),
				).pipe(Effect.andThen(Effect.fail(unexpected(defect)))),
			),
		),
});

const unexpected = failWith(
	"failed",
	"If the message names a file or folder, check it exists and can be written. Otherwise this is a bug: please report it.",
);

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
