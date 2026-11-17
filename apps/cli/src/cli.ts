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
import { type Context, settingsIssueLine } from "@shorts-studio/usecases/context";
import { daysNow } from "@shorts-studio/usecases/days";
import { Budget } from "@shorts-studio/usecases/ledger";
import {
	commandPath,
	flagName,
	type Operation,
	p,
	type RunMode,
} from "@shorts-studio/usecases/operation";
import { configCheck, configShow } from "@shorts-studio/usecases/operations/config";
import { listSlugs, readPost } from "@shorts-studio/usecases/post-store";
import { Console, Effect, Layer, Result, Schema } from "effect";
import { CliOutput, Command, Flag } from "effect/cli";

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

/** The one object `--json` prints for a run: what it gave, and its error if it failed. */
const envelope = (
	command: string,
	fields: Readonly<Record<string, unknown>>,
	error: ShortsError | undefined,
) =>
	JSON.stringify({
		ok: error === undefined,
		outputVersion: OUTPUT_VERSION,
		command,
		...fields,
		...(error === undefined ? {} : { error: reportOf(error) }),
	});

const textError = (error: ShortsError) => `✗ ${error.message}\n  → ${error.fix}`;

const TRUE_WORDS = new Set(["true", "1", "y", "yes", "on"]);
const FALSE_WORDS = new Set(["false", "0", "n", "no", "off"]);

/**
 * Whether the arguments ask for `--json`, in every form effect/cli reads as on: `--json`,
 * `--json=yes`, `--json true`. Read from the raw arguments, because a command called wrong stops
 * before its flags are parsed.
 */
export const jsonRequested = (argv: ReadonlyArray<string>): boolean => {
	let json = false;
	argv.forEach((arg, i) => {
		if (arg === "--json") json = !FALSE_WORDS.has(argv[i + 1] ?? "");
		else if (arg.startsWith("--json=")) json = TRUE_WORDS.has(arg.slice("--json=".length));
		else if (arg === "--no-json") json = false;
	});
	return json;
};

/** The usage error a command called wrong prints with `--json`, for `commandPath`. */
const usageEnvelope = (commandPath: ReadonlyArray<string>, message: string) =>
	envelope(
		// Without the program name, like `command` in every other object.
		commandPath.slice(1).join(" "),
		{},
		fail("usage", message, `See what it takes with: ${commandPath.join(" ")} --help`),
	);

/**
 * With `--json`, a command called wrong prints the one error object, instead of its help: stdout
 * must hold exactly one JSON object. So does a group of commands given no command (`post`).
 * Help asked for with `--help`, and every other output, stay the default.
 */
export const cliOutput = (argv: ReadonlyArray<string>): Layer.Layer<never> =>
	jsonRequested(argv)
		? CliOutput.layerPresenter({
				present: (event) => {
					if (event._tag === "InvalidInvocation") {
						return Console.log(
							usageEnvelope(
								event.commandPath,
								event.errors.map((error) => error.message).join(" "),
							),
						);
					}
					if (event._tag === "Help" && event.reason === "Implicit") {
						return Console.log(
							usageEnvelope(
								event.commandPath,
								`"${event.commandPath.join(" ")}" needs one of its commands.`,
							),
						);
					}
					return CliOutput.defaultPresenter.present(event);
				},
			})
		: Layer.empty;

/** The flags that pick several posts, replacing a single required `--post`. */
const batchFlags = {
	post: p.optional(p.string("Post slug, or several separated by commas")).flag("post"),
	inStage: p.optional(p.literals(Stage.literals, "Every post at this stage")).flag("in-stage"),
	day: p.optional(p.string("Every post created that day: today or YYYY-MM-DD")).flag("day"),
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
	// By folder, the name commands take, even when a post.json was copied from another post.
	const posts = yield* Effect.forEach(yield* listSlugs(ctx), (slug) =>
		Effect.map(readPost(ctx, slug), (post) => ({ slug, post })),
	);
	const matching = posts
		.filter(({ slug }) => day === undefined || slug.startsWith(day))
		.filter(({ post }) => input.inStage === undefined || stageOf(post) === input.inStage)
		.map(({ slug }) => slug);
	if (matching.length > 0) return matching;
	return yield* fail("not-found", "No posts match.", "Check the selection with: post list");
});

/**
 * What an interrupted run fails with: the command to run again. A command that saves its requests
 * picks them up without paying again, as long as `--reroll` doesn't pick new seeds; any other paid
 * call cut off stays counted.
 */
const interruptedError = (op: Operation, label: string) => {
	const again = `Run the same ${label} command again to pick up where it stopped.`;
	const paid =
		op.params["reroll"] !== undefined
			? " Requests already sent are saved and fetched without paying again; leave out --reroll."
			: op.spends
				? " A paid call it cut off stays counted, since the provider may have billed it."
				: "";
	return fail("interrupted", `${label} was interrupted.`, `${again}${paid}`);
};

const confirmationError = (label: string) =>
	fail(
		"needs-confirmation",
		`${label} spends money; nothing was spent.`,
		"Check the estimate above; it fits the caps. To spend it, run the same command with --yes.",
	);

/** A spending result's budget, or undefined for one that has none. */
const budgetOf = (result: unknown): Budget | undefined => {
	const budget = (result as { readonly budget?: unknown } | null)?.budget;
	return Schema.is(Budget)(budget) ? budget : undefined;
};

/** The error the real run would fail with, from what stopped its dry run. */
const refusalOf = (budget: Budget): ShortsError =>
	fail(
		budget.stoppedBy === "settings"
			? "failed"
			: budget.stoppedBy === "missing-key"
				? "missing-key"
				: "over-budget",
		budget.why ?? "The real run can't go ahead; nothing was spent.",
		budget.fix ?? "Run the same command with --dry-run to see what stops it.",
	);

interface SharedFlags {
	readonly json: boolean;
	readonly dryRun: boolean;
	readonly yes: boolean;
}

const leaf = (op: Operation, ctx: Context, name?: string) => {
	// What the user typed, so `doctor` reports itself as `doctor` here and in a usage error.
	const label = name ?? commandPath(op.name).join(" ");
	const batchable = isBatchable(op);
	const flags: Record<string, Flag.Flag<unknown>> = {};
	for (const [key, param] of Object.entries(op.params)) flags[key] = param.flag(flagName(key));
	if (batchable) Object.assign(flags, batchFlags);
	const encode = Schema.encodeUnknownSync(Schema.toCodecJson(op.output));
	const render = (result: unknown) =>
		op.render ? op.render(result) : JSON.stringify(encode(result), null, 2);

	/**
	 * Runs the command on its post or posts. Text results print as each finishes; it returns what
	 * `--json` prints, built only when asked for, and the error the command ends with, if any.
	 */
	const attempt = Effect.fnUntraced(function* (
		input: Record<string, unknown> & Selection,
		shared: SharedFlags,
	) {
		if (shared.dryRun && !op.spends) {
			return yield* fail(
				"usage",
				`${label} spends nothing, so it has no dry run.`,
				"Run it without --dry-run; only spending commands such as image generate take it.",
			);
		}
		// Without --yes a spending command still runs as a dry run, so the user sees the estimate.
		// With --json, it goes in the one object stdout holds, with the error that follows. A
		// command with `needsYes: false` runs for real without --yes.
		const needsConfirmation = op.spends && op.needsYes !== false && !shared.yes && !shared.dryRun;
		const mode: RunMode = { dryRun: shared.dryRun || needsConfirmation, confirmed: shared.yes };
		const posts = batchable ? yield* selectPosts(ctx, input) : undefined;

		/**
		 * What the dry run standing in for a missing --yes leads to. One that can't go ahead fails as
		 * the real run would, so the reader learns what stops it, not that --yes is missing. One that
		 * spends nothing, such as fetching saved requests, runs for real: --yes confirms spending,
		 * and there's none. Any other asks for --yes.
		 */
		const afterDryRun = Effect.fnUntraced(function* (
			postInput: Record<string, unknown>,
			planned: unknown,
		) {
			const outcome = (result: unknown, error?: ShortsError) => ({ result, error });
			if (!needsConfirmation) return outcome(planned);
			const budget = budgetOf(planned);
			if (budget?.fits === false) return outcome(planned, refusalOf(budget));
			if (estimateOf(planned) === 0) {
				// Not confirmed: the real run refuses anything that turned out to cost money.
				return outcome(yield* op.run(postInput, ctx, { dryRun: false, confirmed: false }));
			}
			return outcome(planned, confirmationError(label));
		});

		if (posts === undefined || posts.length === 1) {
			const single = posts === undefined ? input : { ...input, post: posts[0] };
			const { result, error } = yield* afterDryRun(single, yield* op.run(single, ctx, mode));
			if (!shared.json) yield* Console.log(render(result));
			return { fields: () => ({ result: encode(result) }), error };
		}

		// One post after another: each prints as it finishes, and a failure doesn't stop the rest.
		// A dry run counts what it planned for earlier posts, so their budgets add up as one run;
		// a post that can't go ahead won't spend, so it doesn't count. Each post gets its own
		// outcome: one that can't go ahead fails alone.
		let plannedUsd = 0;
		let unconfirmed = 0;
		const results = yield* Effect.forEach(posts, (post) =>
			op.run({ ...input, post }, ctx, { ...mode, plannedUsd }).pipe(
				Effect.tap((planned) =>
					Effect.sync(() => {
						if (mode.dryRun && fitsOf(planned)) plannedUsd += estimateOf(planned);
					}),
				),
				Effect.flatMap((planned) => afterDryRun({ ...input, post }, planned)),
				Effect.flatMap(({ result, error }) => {
					if (error === undefined) return Effect.succeed(result);
					if (error.code !== "needs-confirmation") return Effect.fail(error);
					// Not this post's failure: the batch asks for --yes once, after the last post.
					unconfirmed++;
					return Effect.succeed(result);
				}),
				Effect.result,
				Effect.tap((outcome) =>
					shared.json
						? Effect.void
						: Console.log(`── ${post}`).pipe(
								Effect.andThen(
									Result.isSuccess(outcome)
										? Console.log(render(outcome.success))
										: Console.error(textError(outcome.failure)),
								),
							),
				),
				Effect.map((outcome) => ({ post, outcome })),
			),
		);
		const failed = results.filter(({ outcome }) => Result.isFailure(outcome)).length;
		return {
			fields: () => ({
				results: results.map(({ post, outcome }) =>
					Result.isSuccess(outcome)
						? { post, ok: true, result: encode(outcome.success) }
						: { post, ok: false, error: reportOf(outcome.failure) },
				),
			}),
			error:
				unconfirmed > 0
					? confirmationError(label)
					: failed === 0
						? undefined
						: fail(
								"failed",
								`${failed} of ${posts.length} posts failed.`,
								"Each post's error is listed with it; run the command again to retry them.",
							),
		};
	});

	/** The one place a run's outcome is printed: one JSON object, or the error on stderr. */
	const report = (
		shared: SharedFlags,
		fields: () => Readonly<Record<string, unknown>>,
		error: ShortsError | undefined,
	) =>
		shared.json
			? Console.log(envelope(label, fields(), error))
			: error === undefined
				? Effect.void
				: Console.error(textError(error));

	return Command.make(
		name ?? commandPath(op.name)[1],
		flags,
		Effect.fn(label)(function* (raw) {
			const shared = yield* root;
			if (!SHOWS_SETTINGS.has(op.name)) yield* warnSettings(ctx);
			const { fields, error } = yield* attempt(
				raw as Record<string, unknown> & Selection,
				shared,
			).pipe(
				Effect.catch((error) => Effect.succeed({ fields: () => ({}), error })),
				// Ctrl-C still prints the one object `--json` promises. The run stays interrupted, so
				// it exits 130.
				Effect.onInterrupt(() => report(shared, () => ({}), interruptedError(op, label))),
			);
			yield* report(shared, fields, error);
			if (error !== undefined) return yield* error;
		}),
	).pipe(Command.withDescription(op.description));
};

/** Commands that list the settings' problems themselves, so a warning would say it twice. */
const SHOWS_SETTINGS = new Set([configCheck.name, configShow.name]);

/** A spending result's estimate, or 0 for one that has none. */
const estimateOf = (result: unknown): number => {
	const estimate = (result as { readonly estimateUsd?: unknown } | null)?.estimateUsd;
	return typeof estimate === "number" && Number.isFinite(estimate) ? estimate : 0;
};

/** Whether a dry run's result says its real run could go ahead; true when it has no budget. */
const fitsOf = (result: unknown): boolean =>
	(result as { readonly budget?: { readonly fits?: unknown } } | null)?.budget?.fits !== false;

/**
 * Names, on stderr, each setting that couldn't be used. Its default applies, so a command that
 * runs anyway, such as `budget show`, may show the default caps rather than the user's.
 */
const warnSettings = (ctx: Context) =>
	Effect.forEach(
		ctx.settingsIssues,
		(issue) =>
			Console.error(
				`! A setting can't be used, so its default applies: ${settingsIssueLine(issue)}`,
			),
		{ discard: true },
	);

const NOUNS: Record<string, string> = {
	config: "Settings, folders, keys and tool checks",
	models: "Image and transcription models, their prices, and the one each job uses",
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
