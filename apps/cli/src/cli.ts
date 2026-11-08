/**
 * The CLI: one `noun verb` command per operation, plus `doctor` and `mcp serve`.
 *
 * Output rules (docs/architecture.md#agent-interface): results go to stdout, as text, or as one
 * JSON object with `--json`. Progress and diagnostics go to stderr. A failure prints its fix
 * and sets the exit code from the error's code.
 *
 * On the CLI, commands that act on one existing post can also run on several (`--post a,b`,
 * `--day`, `--in-stage`). MCP tools stay single-post: an agent loops instead, and each tool
 * keeps one input shape and one output shape.
 */

import { fail, reportOf, type ShortsError } from "@shorts-studio/domain/errors";
import { Stage, stageOf } from "@shorts-studio/domain/post";
import type { Context } from "@shorts-studio/usecases/context";
import { daysNow } from "@shorts-studio/usecases/days";
import {
	commandPath,
	flagName,
	type Operation,
	type RunMode,
} from "@shorts-studio/usecases/operation";
import { listSlugs, readPost } from "@shorts-studio/usecases/post-store";
import { Console, Effect, Option, Result, Schema } from "effect";
import { Command, Flag } from "effect/cli";

export const OUTPUT_VERSION = 1;

const sharedFlags = {
	json: Flag.Boolean("json").pipe(
		Flag.withDescription("Print one JSON object on stdout (diagnostics stay on stderr)"),
		Flag.withDefault(false),
	),
	dryRun: Flag.Boolean("dry-run").pipe(
		Flag.withDescription("Spending commands only: show the plan and estimated cost; spend nothing"),
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
					error: reportOf(error),
				}),
			)
		: Console.error(`✗ ${error.message}\n  → ${error.fix}`);

const optional = <A>(flag: Flag.Flag<A>) =>
	flag.pipe(Flag.optional, Flag.map(Option.getOrUndefined));

/** The flags that pick several posts, replacing a single required `--post`. */
const batchFlags = {
	post: optional(
		Flag.String("post").pipe(Flag.withDescription("Post slug, or several separated by commas")),
	),
	inStage: optional(
		Flag.Literals("in-stage", Stage.literals).pipe(
			Flag.withDescription("Every post at this stage"),
		),
	),
	day: optional(
		Flag.String("day").pipe(
			Flag.withDescription("Every post created that day: today or YYYY-MM-DD"),
		),
	),
};

/** A command acting on one existing post (a required `post`) can run on several. */
const isBatchable = (op: Operation): boolean =>
	op.params["post"] !== undefined &&
	op.params["post"].optional !== true &&
	op.name !== "post_create";

interface Selection {
	readonly post?: string | undefined;
	readonly inStage?: typeof Stage.Type | undefined;
	readonly day?: string | undefined;
}

/** The posts a batch selection names; one slug means a normal single run. */
const selectPosts = Effect.fn("selectPosts")(function* (ctx: Context, input: Selection) {
	if (input.inStage === undefined && input.day === undefined) {
		const slugs = (input.post ?? "")
			.split(",")
			.map((slug) => slug.trim())
			.filter(Boolean);
		if (slugs.length > 0) return slugs;
		return yield* fail(
			"usage",
			"No post given.",
			"Pass --post <slug> (or several, comma-separated), --day or --in-stage.",
		);
	}
	const day = input.day === "today" ? daysNow(ctx).today : input.day;
	if (day !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(day)) {
		return yield* fail("usage", `"${input.day}" isn't a day.`, "Use today or YYYY-MM-DD.");
	}
	const posts = yield* Effect.forEach(listSlugs(ctx), (slug) => readPost(ctx, slug));
	const matching = posts
		.filter((post) => day === undefined || post.slug.startsWith(day))
		.filter((post) => input.inStage === undefined || stageOf(post) === input.inStage)
		.map((post) => post.slug);
	if (matching.length > 0) return matching;
	return yield* fail("not-found", "No posts match.", "Check the selection with: post list");
});

const confirmationError = (label: string) =>
	fail(
		"needs-confirmation",
		`${label} spends money; nothing was spent.`,
		"Check the estimate above, then run the same command with --yes.",
	);

const leaf = (op: Operation, ctx: Context, name?: string) => {
	const label = commandPath(op.name).join(" ");
	const batchable = isBatchable(op);
	const flags: Record<string, Flag.Flag<unknown>> = {};
	for (const [key, param] of Object.entries(op.params)) flags[key] = param.flag(flagName(key));
	if (batchable) Object.assign(flags, batchFlags);
	const encode = Schema.encodeUnknownSync(Schema.toCodecJson(op.output));
	const render = (result: unknown) =>
		op.render ? op.render(result) : JSON.stringify(encode(result), null, 2);

	return Command.make(name ?? commandPath(op.name)[1], flags, (raw) =>
		Effect.gen(function* () {
			const shared = yield* root;
			if (shared.dryRun && !op.spends) {
				const error = fail(
					"usage",
					`${label} spends nothing, so it has no dry run.`,
					"Run it without --dry-run; only spending commands such as image generate take it.",
				);
				yield* printError(error, shared.json, label);
				return yield* error;
			}
			// Without --yes a spending command still runs as a dry run, so the user sees the estimate,
			// then fails asking for --yes. With --json, both go in the one object stdout holds. A
			// command with `needsYes: false` runs for real without --yes.
			const needsConfirmation = op.spends && op.needsYes !== false && !shared.yes && !shared.dryRun;
			const confirmation = needsConfirmation ? confirmationError(label) : undefined;
			const mode: RunMode = { dryRun: shared.dryRun || needsConfirmation, confirmed: shared.yes };
			const input = raw as Record<string, unknown> & Selection;
			const posts = batchable
				? yield* selectPosts(ctx, input).pipe(
						Effect.tapError((error) => printError(error, shared.json, label)),
					)
				: undefined;

			if (posts === undefined || posts.length === 1) {
				const single = posts === undefined ? input : { ...input, post: posts[0] };
				const result = yield* op
					.run(single, ctx, mode)
					.pipe(Effect.tapError((error) => printError(error, shared.json, label)));
				yield* shared.json
					? Console.log(
							JSON.stringify({
								ok: confirmation === undefined,
								outputVersion: OUTPUT_VERSION,
								command: label,
								result: encode(result),
								...(confirmation === undefined ? {} : { error: reportOf(confirmation) }),
							}),
						)
					: Console.log(render(result));
			} else {
				// One post after another: each prints as it finishes, and a failure doesn't stop the rest.
				const results = yield* Effect.forEach(posts, (post) =>
					Effect.result(op.run({ ...input, post }, ctx, mode)).pipe(
						Effect.tap((outcome) =>
							shared.json
								? Effect.void
								: Console.log(`── ${post}`).pipe(
										Effect.andThen(
											Result.isSuccess(outcome)
												? Console.log(render(outcome.success))
												: Console.error(`✗ ${outcome.failure.message}\n  → ${outcome.failure.fix}`),
										),
									),
						),
						Effect.map((outcome) => ({ post, outcome })),
					),
				);
				const failed = results.filter(({ outcome }) => Result.isFailure(outcome)).length;
				if (shared.json) {
					yield* Console.log(
						JSON.stringify({
							ok: failed === 0 && confirmation === undefined,
							outputVersion: OUTPUT_VERSION,
							command: label,
							results: results.map(({ post, outcome }) =>
								Result.isSuccess(outcome)
									? { post, ok: true, result: encode(outcome.success) }
									: { post, ok: false, error: reportOf(outcome.failure) },
							),
							...(confirmation === undefined ? {} : { error: reportOf(confirmation) }),
						}),
					);
				}
				if (failed > 0 && confirmation === undefined) {
					const error = fail(
						"failed",
						`${failed} of ${posts.length} posts failed.`,
						"Each post's error is above; run the command again to retry them.",
					);
					// With --json the batch object above already says so.
					if (!shared.json) yield* printError(error, false, label);
					return yield* error;
				}
			}
			if (confirmation !== undefined) {
				// With --json the object above already holds this error.
				if (!shared.json) yield* printError(confirmation, false, label);
				return yield* confirmation;
			}
		}),
	).pipe(Command.withDescription(op.description));
};

const NOUNS: Record<string, string> = {
	config: "Settings, folders, keys and tool checks",
	post: "Create, list, review and publish posts",
	script: "The story the user approves before anything is spent",
	source: "Bring audio into a post, and download or transcribe saved collections",
	audio: "Transcribe audio with word timings",
	beat: "Split the audio into beats and give each an image prompt",
	image: "Generate or attach one image per beat",
	draft: "Render the reviewable draft video",
	capcut: "Hand an approved draft to CapCut desktop",
	budget: "Spend against the daily and per-post caps",
	schema: "JSON Schemas of post.json and every command",
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

/** A top-level shortcut for an operation, such as `doctor` for `config check`. */
export const aliasCommand = (op: Operation, ctx: Context, name: string) => leaf(op, ctx, name);
