/**
 * The CLI surface: one `noun verb` command per operation, plus `mcp serve`.
 *
 * Output rules (docs/architecture.md#agent-interface): results go to stdout, as text or, with
 * `--json`, one JSON object; progress and diagnostics go to stderr. Failures print their fix
 * and set the exit code from the error's code.
 */

import { Console, Effect, Schema } from "effect";
import { Command, Flag } from "effect/cli";
import type { Context } from "../core/context.ts";
import { fail, type ShortsError } from "../core/errors.ts";
import { commandPath, flagName, type Operation, type RunMode } from "../core/operation.ts";

export const OUTPUT_VERSION = 1;

const sharedFlags = {
	json: Flag.Boolean("json").pipe(
		Flag.withDescription("Print one JSON object on stdout (diagnostics stay on stderr)"),
		Flag.withDefault(false),
	),
	dryRun: Flag.Boolean("dry-run").pipe(
		Flag.withDescription("Describe the files and estimated cost; change and spend nothing"),
		Flag.withDefault(false),
	),
	yes: Flag.Boolean("yes").pipe(
		Flag.withDescription("Confirm a step that spends money"),
		Flag.withDefault(false),
	),
};

export const root = Command.make("shorts-studio").pipe(
	Command.withSharedFlags(sharedFlags),
	Command.withDescription(
		"Turn audio into vertical short videos with AI images, word-timed captions and FFmpeg.",
	),
);

const printError = (error: ShortsError, json: boolean, command: string) =>
	json
		? Console.log(
				JSON.stringify({
					ok: false,
					outputVersion: OUTPUT_VERSION,
					command,
					error: { code: error.code, message: error.message, fix: error.fix },
				}),
			)
		: Console.error(`✗ ${error.message}\n  → ${error.fix}`);

const leaf = (op: Operation, ctx: Context) => {
	const [, verb] = commandPath(op.name);
	const label = commandPath(op.name).join(" ");
	const flags: Record<string, Flag.Flag<unknown>> = {};
	for (const [key, param] of Object.entries(op.params)) flags[key] = param.flag(flagName(key));
	const encode = Schema.encodeUnknownSync(Schema.toCodecJson(op.output));

	return Command.make(verb, flags, (input) =>
		Effect.gen(function* () {
			const shared = yield* root;
			const needsConfirmation = op.spends && !shared.yes && !shared.dryRun;
			const mode: RunMode = { dryRun: shared.dryRun || needsConfirmation, confirmed: shared.yes };
			const result = yield* op
				.run(input as never, ctx, mode)
				.pipe(Effect.tapError((error) => printError(error, shared.json, label)));
			if (shared.json) {
				yield* Console.log(
					JSON.stringify({
						ok: true,
						outputVersion: OUTPUT_VERSION,
						command: label,
						result: encode(result),
					}),
				);
			} else {
				yield* Console.log(op.render ? op.render(result) : JSON.stringify(encode(result), null, 2));
			}
			if (needsConfirmation) {
				const error = fail(
					"needs-confirmation",
					`${label} spends money; nothing was spent.`,
					"Check the estimate above, then run the same command with --yes.",
				);
				yield* printError(error, shared.json, label);
				return yield* Effect.fail(error);
			}
		}),
	).pipe(Command.withDescription(op.description));
};

const NOUNS: Record<string, string> = {
	config: "Settings, folders, keys and tool checks",
	post: "Create, list and inspect posts",
	script: "The story the user approves before anything is spent",
	source: "Bring audio into a post, and download or transcribe saved collections",
	audio: "Transcribe audio with word timings",
	beat: "Split the audio into beats and give each an image prompt",
	image: "Generate or attach one image per beat",
	draft: "Render the reviewable draft video",
	capcut: "Hand an approved draft to CapCut desktop",
	budget: "Spend against the daily and per-post caps",
};

/** Groups operations by noun: `post create`, `post list`, … */
export const nounCommands = (operations: ReadonlyArray<Operation>, ctx: Context) => {
	const groups = new Map<string, Array<Operation>>();
	for (const op of operations) {
		const [noun] = commandPath(op.name);
		groups.set(noun, [...(groups.get(noun) ?? []), op]);
	}
	return [...groups.entries()].map(([noun, ops]) =>
		Command.make(noun).pipe(
			Command.withDescription(NOUNS[noun] ?? noun),
			Command.withSubcommands(ops.map((op) => leaf(op, ctx))),
		),
	);
};
