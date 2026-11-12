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

/** A field of a tool's input Schema. Decoding it needs no services, so neither do the handlers. */
type Field = Schema.Codec<unknown, unknown>;

export interface Param<A> {
	/**
	 * The field in the MCP tool's input Schema. MCP input is decoded through it, so it gives a
	 * missing value the same default the CLI flag does.
	 */
	readonly field: Field;
	/** The CLI flag; its name is set when the operation is built, from the parameter's key. */
	readonly flag: (flagName: string) => Flag.Flag<A>;
	/** Set by `p.optional`. */
	readonly optional?: true;
}

export type Params = Readonly<Record<string, Param<unknown>>>;
export type InputOf<P extends Params> = {
	readonly [K in keyof P]: P[K] extends Param<infer A> ? A : never;
};

const described = <A>(flag: Flag.Flag<A>, description: string): Flag.Flag<A> =>
	flag.pipe(Flag.withDescription(description));

/** An optional boolean that reads as false when left out, like a CLI flag that isn't passed. */
const booleanField = (description: string): Field =>
	// Annotated first, so the description reaches the published JSON Schema.
	Schema.Boolean.annotate({ description }).pipe(
		Schema.withDecodingDefaultKey(Effect.succeed(false)),
	);

export const p = {
	string: (description: string): Param<string> => ({
		field: Schema.String.annotate({ description }),
		flag: (name) => described(Flag.String(name), description),
	}),
	int: (description: string): Param<number> => ({
		field: Schema.Int.annotate({ description }),
		flag: (name) => described(Flag.Int(name), description),
	}),
	boolean: (description: string): Param<boolean> => ({
		field: booleanField(description),
		flag: (name) => described(Flag.Boolean(name), description).pipe(Flag.withDefault(false)),
	}),
	literals: <const L extends ReadonlyArray<string>>(
		values: L,
		description: string,
	): Param<L[number]> => ({
		field: Schema.Literals(values).annotate({ description }),
		flag: (name) => described(Flag.Literals(name, values), description),
	}),
	optional: <A>(param: Param<A>): Param<A | undefined> => ({
		field: Schema.optionalKey(param.field),
		flag: (name) => param.flag(name).pipe(Flag.optional, Flag.map(Option.getOrUndefined)),
		optional: true,
	}),
};

/** How a run was asked for: the CLI's `--dry-run` / `--yes`, or an MCP call. */
export interface RunMode {
	/** Describe what would happen (files, estimated cost) and change nothing. */
	readonly dryRun: boolean;
	/** Spending is confirmed. Always true over MCP, where the client's approval is the gate. */
	readonly confirmed: boolean;
	/**
	 * What a batch dry run already planned to spend on earlier posts, so each post's budget counts
	 * it toward the day and the month. Absent outside a batch.
	 */
	readonly plannedUsd?: number;
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

/** `text` as a regular expression that matches only itself. */
const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A field name other than these. A rest record checks every key its key schema accepts, declared
 * fields included, so a plain string key would fail every field the tool does take.
 */
const otherThan = (names: ReadonlyArray<string>) =>
	Schema.String.pipe(
		Schema.check(Schema.isPattern(new RegExp(`^(?!(?:${names.map(escapeRegExp).join("|")})$)`))),
	);

/**
 * A tool's input: its parameters, plus `dryRun` when it spends. A field it doesn't take fails,
 * naming the fields it does: Effect would otherwise drop it, so a misspelt `dry_run` would be
 * ignored and the call would spend.
 */
export const toolInputSchema = (op: Operation) => {
	const fields: Record<string, Field> = {};
	for (const [key, param] of Object.entries(op.params)) fields[key] = param.field;
	if (op.spends) {
		fields["dryRun"] = booleanField(
			"Describe the files and estimated cost without spending anything",
		);
	}
	const names = Object.keys(fields);
	const unknownField = Schema.Never.annotate({
		message: `This tool doesn't take this field. It takes: ${names.join(", ") || "nothing"}`,
	});
	return Schema.StructWithRest(Schema.Struct(fields), [
		Schema.Record(otherThan(names), unknownField),
	]);
};
