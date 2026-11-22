/**
 * Creating, listing and showing posts. `post show` always answers "what now?" with `next`, the
 * command that moves the post forward, and `nextSteps`, the same steps as data an agent can call.
 */

import { join } from "node:path";
import { fail } from "@shorts-studio/domain/errors";
import {
	changesSinceApproval,
	currentReview,
	isScriptApproved,
	type Post,
	Stage,
	stageOf,
} from "@shorts-studio/domain/post";
import { Effect, Schema } from "effect";
import type { Context } from "../context.ts";
import { daysNow } from "../days.ts";
import { type Freshness, freshnessOf, UP_TO_DATE } from "../freshness.ts";
import type { Budget } from "../ledger.ts";
import { commandPath, defineOperation, flagName, p } from "../operation.ts";
import { createPost, DATED, listSlugs, postDir, readPost } from "../post-store.ts";

type Arg = string | boolean;

/** A value the agent fills in before running the step, such as `<final.mp4>`. */
const PLACEHOLDER = /^<[^<>]+>$/;

/**
 * One step that moves a post forward. An agent's step names its MCP tool and arguments; `cli` is
 * the same command for the terminal, without the program's name, like every `fix`. A user's step
 * (an approval, watching the draft) has no tool. `or` marks a step that replaces the one before.
 */
export const NextStep = Schema.Struct({
	by: Schema.Literals(["agent", "user"]),
	or: Schema.optionalKey(Schema.Boolean),
	cli: Schema.optionalKey(Schema.String),
	tool: Schema.optionalKey(Schema.String),
	args: Schema.optionalKey(
		Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Boolean])),
	),
	/** The arguments whose value is a placeholder (`<final.mp4>`): the agent fills them in first. */
	fill: Schema.optionalKey(Schema.Array(Schema.String)),
	note: Schema.optionalKey(Schema.String),
});
export type NextStep = typeof NextStep.Type;

/** `next` and `nextSteps`, for every output that moves a post on. */
export const NextFields = { next: Schema.String, nextSteps: Schema.Array(NextStep) };

/**
 * `value` as one shell word: as it is when that's safe, else in single quotes. A placeholder stays
 * as written, so it still reads as one.
 */
const shellWord = (value: string): string =>
	/^[\w@%+=:,./-]+$/.test(value) || PLACEHOLDER.test(value)
		? value
		: `'${value.replaceAll("'", "'\\''")}'`;

/** The terminal command for a tool call: `image_generate { post, dryRun }` → `image generate --post … --dry-run`. */
const cliOf = (tool: string, args: Readonly<Record<string, Arg>>, yes: boolean): string =>
	[
		...commandPath(tool),
		...Object.entries(args).flatMap(([key, value]) =>
			value === true
				? [`--${flagName(key)}`]
				: value === false
					? []
					: [`--${flagName(key)}`, shellWord(value)],
		),
		...(yes ? ["--yes"] : []),
	].join(" ");

interface StepOptions {
	readonly note?: string;
	readonly or?: boolean;
	/** On the CLI the real run of a spending command needs `--yes`; over MCP the client asks. */
	readonly yes?: boolean;
}

/** An agent's step: an MCP tool call and the same command for the terminal. */
export const agentStep = (
	tool: string,
	args: Readonly<Record<string, Arg>>,
	{ note, or, yes = false }: StepOptions = {},
): NextStep => {
	const fill = Object.entries(args)
		.filter(([, value]) => typeof value === "string" && PLACEHOLDER.test(value))
		.map(([key]) => key);
	return {
		by: "agent",
		...(or ? { or } : {}),
		cli: cliOf(tool, args, yes),
		tool,
		args: { ...args },
		...(fill.length === 0 ? {} : { fill }),
		...(note === undefined ? {} : { note }),
	};
};

/** A step for the user to take, such as an approval, which no agent can run. */
const userStep = (cli: string | undefined, note?: string): NextStep => ({
	by: "user",
	...(cli === undefined ? {} : { cli }),
	...(note === undefined ? {} : { note }),
});

/** A step with nothing to run, such as applying review notes. */
const agentNote = (note: string): NextStep => ({ by: "agent", note });

/** `n prompt(s)`. */
const prompts = (n: number): string => `${n} prompt${n === 1 ? "" : "s"}`;

/** The user's notes on a draft that needs fixes, one step each, in front of whatever comes next. */
const reviewNotes = (post: Post): ReadonlyArray<NextStep> => {
	const review = currentReview(post);
	if (review?.decision !== "fix") return [];
	return [
		...(review.note === undefined ? [] : [agentNote(`the user's note: "${review.note}"`)]),
		...(review.beatNotes ?? []).map(({ beat, note }) =>
			agentNote(
				`beat ${beat}: "${note}": change it with beat set (prompt, moment or motion; a new prompt needs the user's script approve), image generate --post ${post.slug} --beat ${beat} --reroll --dry-run, or image import --post ${post.slug} --beat ${beat} --file <image>`,
			),
		),
	];
};

/** What a finished video leads to: publishing it, then archiving it. */
const finishedSteps = (post: Post, stage: Stage): ReadonlyArray<NextStep> => {
	const thisPost = { post: post.slug };
	return stage === "final"
		? [
				agentStep(
					"post_publish",
					{ ...thisPost, platform: "<platform>", url: "<url>" },
					{ note: "instagram, tiktok or youtube" },
				),
			]
		: [
				agentStep(
					"post_publish",
					{ ...thisPost, platform: "<another platform>", url: "<url>" },
					{ note: "for another platform" },
				),
				agentStep("post_archive", thisPost, { or: true }),
			];
};

/** The steps before the draft that redo what's missing or out of date, or none once all is there. */
const stepsBeforeDraft = (post: Post, fresh: Freshness): ReadonlyArray<NextStep> | undefined => {
	const thisPost = { post: post.slug };
	const { audio, beats } = post;
	if (audio === undefined && post.script === undefined) {
		return [
			agentStep("source_import", {
				...thisPost,
				file: "<audio-or-video>",
				origin: "mine",
				kind: "speech",
			}),
			agentStep("script_set", { ...thisPost, file: "script.md" }, { or: true }),
		];
	}
	if (audio !== undefined) {
		// Music skips transcription: neither its beats nor its captions use words.
		if (audio.kind === "speech" && fresh.transcript !== "current") {
			return [agentStep("audio_transcribe", { ...thisPost, dryRun: true })];
		}
		if (beats === undefined) return [agentStep("beat_plan", thisPost)];
		if (fresh.beats === "stale") {
			const withPrompts = beats.items.filter((b) => b.prompt !== undefined).length;
			const from = audio.kind === "music" ? "earlier audio" : "an earlier transcript";
			const moments = beats.items.some((b) => b.moment !== undefined)
				? "; mark the story moments again after it"
				: "";
			return [
				agentStep("beat_plan", withPrompts > 0 ? { ...thisPost, force: true } : thisPost, {
					note:
						withPrompts > 0
							? `the beats were cut from ${from}; planning again drops their ${prompts(withPrompts)}${moments}`
							: `the beats were cut from ${from}${moments}`,
				}),
			];
		}
		if (beats.items.some((b) => b.prompt === undefined)) {
			const setPrompts = (or: boolean) =>
				agentStep(
					"beat_set",
					{ ...thisPost, from: "<beats.json>" },
					{
						note: "a story moment and an image prompt for every beat: see the story-direction skill",
						or,
					},
				);
			// A re-cut by moment drops prompts, so it's offered only before any are written.
			const reCut =
				beats.items.every((b) => b.prompt === undefined) &&
				beats.items.some((b) => b.moment !== undefined) &&
				!fresh.recut;
			return reCut
				? [
						agentStep(
							"beat_plan",
							{ ...thisPost, byMoment: true },
							{ note: "re-cut each story moment to its beat length, before writing the prompts" },
						),
						setPrompts(true),
					]
				: [setPrompts(false)];
		}
	}
	if (post.script === undefined)
		return [agentStep("script_set", { ...thisPost, file: "script.md" })];
	if (!isScriptApproved(post)) {
		const changed = changesSinceApproval(post);
		const why = changed.length === 0 ? "" : `; changed since approval: ${changed.join(", ")}`;
		return [
			userStep(
				`script approve --post ${post.slug}`,
				`the user's morning check, in their terminal${why}`,
			),
		];
	}
	if (audio === undefined) {
		return [
			agentStep("source_import", { ...thisPost, file: "<audio>", origin: "ai", kind: "speech" }),
		];
	}
	const toMake = fresh.images.filter((image) => !(image.imported && image.why === "file-gone"));
	const toImport = fresh.images.filter((image) => image.imported && image.why === "file-gone");
	if (toMake.length > 0 || toImport.length > 0) {
		// A dry run first, so the user sees the estimate; its own next step is the real run. It
		// names the beats only while some beat has a usable image, so the rest aren't planned.
		const all = toMake.length === (beats?.items.length ?? 0);
		const beatList = toMake.map((image) => image.beat).join(",");
		return [
			...(toMake.length === 0
				? []
				: [
						agentStep(
							"image_generate",
							all ? { ...thisPost, dryRun: true } : { ...thisPost, beat: beatList, dryRun: true },
						),
					]),
			...toImport.map(({ beat }) =>
				agentNote(
					`beat ${beat}'s imported image is gone: import it again with image import --post ${post.slug} --beat ${beat} --file <image>`,
				),
			),
		];
	}
	if (post.draft === undefined) return [agentStep("draft_render", thisPost)];
	return undefined;
};

/** The user's evening check of the draft. */
const reviewSteps = (post: Post): ReadonlyArray<NextStep> => [
	userStep(
		undefined,
		`watch ${join("<posts>", "mine", post.slug, post.draft?.file ?? "draft.mp4")}`,
	),
	userStep(
		`post review --post ${post.slug} --decision <decision>`,
		"approve, fix or reject: the user's evening check, CLI only",
	),
];

/**
 * What to do next, given what's recorded and `fresh`, whether each output still matches the
 * post's own inputs. The first gap from the top wins; approvals and reviews are the user's.
 */
export const nextStepsOf = (post: Post, fresh: Freshness = UP_TO_DATE): ReadonlyArray<NextStep> => {
	const stage = stageOf(post);
	if (stage === "archived") return [];
	// The video is finished, so nothing upstream matters any more.
	if (stage === "final" || stage === "posted") return finishedSteps(post, stage);
	const thisPost = { post: post.slug };
	const notes = stage === "needs-fix" ? reviewNotes(post) : [];
	const before = stepsBeforeDraft(post, fresh);
	if (before !== undefined) return [...notes, ...before];
	switch (stage) {
		case "draft":
			return fresh.draft === "stale"
				? [agentStep("draft_render", thisPost), ...reviewSteps(post)]
				: reviewSteps(post);
		// Until a fix changes the draft's inputs, rendering would do nothing: the notes come first.
		case "needs-fix":
			return fresh.draft === "stale"
				? [...notes, agentStep("draft_render", thisPost)]
				: [
						...notes,
						agentNote(
							`once the fixes are made, render the draft again: draft render --post ${post.slug}`,
						),
					];
		case "rejected":
			return fresh.draft === "stale"
				? [agentStep("draft_render", thisPost), ...reviewSteps(post)]
				: [
						userStep(
							`post archive --post ${post.slug}`,
							"the user rejected the draft: ask them whether to rework the post or archive it",
						),
					];
		case "approved":
			return fresh.exportMatches
				? [
						agentStep("capcut_export", thisPost),
						userStep(undefined, "polish in CapCut desktop"),
						agentStep("post_finalize", { ...thisPost, file: "<final.mp4>" }),
					]
				: [agentStep("draft_render", thisPost), ...reviewSteps(post)];
		default:
			return [agentStep("draft_render", thisPost)];
	}
};

/** The steps as one line of text: `then` between steps, `or` before a step that replaces one. */
export const nextText = (steps: ReadonlyArray<NextStep>): string =>
	steps.length === 0
		? "nothing: the post is archived"
		: steps
				.map((step, i) => {
					const text =
						step.cli === undefined
							? (step.note ?? "")
							: step.note === undefined
								? step.cli
								: `${step.cli}   (${step.note})`;
					return i === 0 ? text : `${step.or ? ", or: " : ", then: "}${text}`;
				})
				.join("");

/** `next` and `nextSteps` from steps. */
const nextFields = (
	nextSteps: ReadonlyArray<NextStep>,
): { next: string; nextSteps: ReadonlyArray<NextStep> } => ({
	next: nextText(nextSteps),
	nextSteps,
});

/**
 * `next` and `nextSteps` for a post, as every output that moves a post on returns them. After the
 * CapCut export (`exported`), the steps start at polishing: exporting again isn't a step.
 */
export const nextOf = (ctx: Context, post: Post, options: { readonly exported?: boolean } = {}) =>
	Effect.map(freshnessOf(ctx, post), (fresh) => {
		const steps = nextStepsOf(post, fresh);
		return nextFields(
			options.exported ? steps.filter((step) => step.tool !== "capcut_export") : steps,
		);
	});

/**
 * Who clears what stops a dry run: the user first, whatever it is, since an agent may neither
 * fix the user's settings, set a key, nor decide about a cap. After a settings fix, the agent's
 * `config_check` lists any setting still in the way.
 */
const clearTheWay = (budget: Budget): ReadonlyArray<NextStep> => {
	const why = budget.why ?? budget.stoppedBy;
	// The fix names the key and where to set it, or the cap and where it was set.
	const whyAndFix = budget.fix === undefined ? why : `${why} ${budget.fix}`;
	switch (budget.stoppedBy) {
		case "settings":
			return [
				userStep(undefined, `the user fixes the setting: ${why}`),
				agentStep(
					"config_check",
					{},
					{ note: "lists every setting that can't be used; run it after the fix" },
				),
			];
		case "missing-key":
			return [userStep(undefined, `the user sets the key: ${whyAndFix}`)];
		default:
			return [userStep(undefined, `the estimate doesn't fit, so ask the user: ${whyAndFix}`)];
	}
};

/**
 * What follows a dry run: the real run when it could go ahead. When it couldn't, the user's step
 * for what stops it, then `fetchFree`, if given: fetching what's already paid for spends nothing,
 * so neither a cap nor a setting stops it, but a missing key does.
 */
export const nextAfterDryRun = (
	budget: Budget,
	realRun: NextStep,
	fetchFree?: NextStep,
): { next: string; nextSteps: ReadonlyArray<NextStep> } => {
	return nextFields(
		budget.fits
			? [realRun]
			: [
					...clearTheWay(budget),
					...(fetchFree === undefined || budget.stoppedBy === "missing-key" ? [] : [fetchFree]),
				],
	);
};

/** The next command as text, for a `fix`. */
export const nextStep = (ctx: Context, post: Post) => Effect.map(nextOf(ctx, post), (n) => n.next);

/**
 * Fails unless the user's current review approves the draft, by who acts next: while the draft
 * waits for the review, or after the user rejected it, the user (`needs-approval`); after they
 * asked for fixes, the agent (`conflict`), with each note. `command` is what was refused.
 */
export const refuseUnapproved = (ctx: Context, post: Post, command: string) =>
	Effect.gen(function* () {
		const review = currentReview(post);
		if (review?.decision === "approve") return;
		const slug = post.slug;
		if (post.draft === undefined) {
			return yield* fail(
				"not-found",
				`${slug} has no draft yet, so ${command} can't run.`,
				yield* nextStep(ctx, post),
			);
		}
		if (review === undefined) {
			return yield* fail(
				"needs-approval",
				`${slug}'s draft waits for the user's review, so ${command} can't run yet.`,
				`The user watches the draft, then decides in their terminal: post review --post ${slug} --decision <decision>`,
			);
		}
		if (review.decision === "reject") {
			return yield* fail(
				"needs-approval",
				`The user rejected ${slug}'s draft, so ${command} can't run.`,
				`Ask the user whether to rework the post or archive it: post archive --post ${slug}`,
			);
		}
		const notes = reviewNotes(post).map((step) => step.note ?? "");
		return yield* fail(
			"conflict",
			`The user asked for fixes to ${slug}'s draft, so ${command} can't run yet.`,
			`${notes.length === 0 ? "Make the fixes" : `Make the fixes: ${notes.join("; ")}`}. Then draft render --post ${slug}; the user reviews the new draft.`,
		);
	});

/** The current review, for `post show`'s text: its decision and time, its note, each beat's note. */
const reviewLines = (post: Post): ReadonlyArray<string> => {
	const review = currentReview(post);
	if (review === undefined) return [];
	return [
		`  review: ${review.decision}, ${review.at}`,
		...(review.note === undefined ? [] : [`    note: ${review.note}`]),
		...(review.beatNotes ?? []).map(({ beat, note }) => `    beat ${beat}: ${note}`),
	];
};

const PostSummary = Schema.Struct({
	slug: Schema.String,
	stage: Stage,
	title: Schema.optionalKey(Schema.String),
});

const summary = (post: Post): typeof PostSummary.Type => ({
	slug: post.slug,
	stage: stageOf(post),
	...(post.brief?.title !== undefined ? { title: post.brief.title } : {}),
});

export const postCreate = defineOperation({
	name: "post_create",
	description:
		"Create a post folder. Today's date goes in front of the slug unless it already starts with a date. The result gives the final slug.",
	params: {
		post: p.string("Slug for the post, e.g. morning-routine"),
		title: p.optional(p.string("Working title")),
		notes: p.optional(p.string("Brief: idea, angle, audience, references")),
	},
	output: Schema.Struct({ slug: Schema.String, dir: Schema.String, ...NextFields }),
	surface: "cli-and-mcp",
	spends: false,
	hints: { readonly: false, destructive: false, idempotent: false, openWorld: false },
	run: Effect.fn("post_create")(function* (input, ctx) {
		// One clock read, so the slug's date and createdAt agree even at midnight.
		const { at, today } = daysNow(ctx);
		const slug = DATED.test(input.post) ? input.post : `${today}-${input.post}`;
		const brief = {
			...(input.title !== undefined ? { title: input.title } : {}),
			...(input.notes !== undefined ? { notes: input.notes } : {}),
		};
		const post = yield* createPost(ctx, {
			slug,
			createdAt: at,
			...(Object.keys(brief).length > 0 ? { brief } : {}),
			aiGenerated: true,
		});
		return { slug, dir: postDir(ctx, slug), ...(yield* nextOf(ctx, post)) };
	}),
	render: (o) => `Created ${o.slug}\n  ${o.dir}\nNext: ${o.next}`,
});

export const postList = defineOperation({
	name: "post_list",
	description:
		"List posts, newest first, with their stage. Archived posts show only with stage archived.",
	params: {
		stage: p.optional(p.literals(Stage.literals, "Only posts at this stage")),
	},
	output: Schema.Struct({ posts: Schema.Array(PostSummary) }),
	surface: "cli-and-mcp",
	spends: false,
	hints: { readonly: true, destructive: false, idempotent: true, openWorld: false },
	run: (input, ctx) =>
		listSlugs(ctx).pipe(
			// Named by folder, the name every command takes, even when post.json was copied from another.
			Effect.flatMap((slugs) =>
				Effect.forEach(slugs, (slug) =>
					Effect.map(readPost(ctx, slug), (post) => ({ ...summary(post), slug })),
				),
			),
			Effect.map((posts) => ({
				// Archived posts show only when asked for by stage.
				posts: posts.filter((post) =>
					input.stage === undefined ? post.stage !== "archived" : post.stage === input.stage,
				),
			})),
		),
	render: (o) =>
		o.posts.length === 0
			? "No posts yet. Create one with: post create --post <slug>"
			: o.posts
					.map(
						(post) => `${post.stage.padEnd(16)} ${post.slug}${post.title ? `  ${post.title}` : ""}`,
					)
					.join("\n"),
});

export const postShow = defineOperation({
	name: "post_show",
	description: "Show a post's post.json, its stage and the next command to run.",
	params: { post: p.string("Post slug") },
	output: Schema.Struct({
		slug: Schema.String,
		stage: Stage,
		dir: Schema.String,
		...NextFields,
		manifest: Schema.Unknown,
	}),
	surface: "cli-and-mcp",
	spends: false,
	hints: { readonly: true, destructive: false, idempotent: true, openWorld: false },
	run: Effect.fn("post_show")(function* (input, ctx) {
		const post = yield* readPost(ctx, input.post);
		return {
			slug: post.slug,
			stage: stageOf(post),
			dir: postDir(ctx, post.slug),
			...(yield* nextOf(ctx, post)),
			manifest: post,
		};
	}),
	render: (o) => {
		const post = o.manifest as Post;
		const beats = post.beats?.items ?? [];
		const lines = [
			`${o.slug}  (${o.stage})`,
			`  ${o.dir}`,
			post.audio
				? `  audio: ${post.audio.file}, ${post.audio.durationSec.toFixed(1)} s, ${post.audio.origin}/${post.audio.kind}`
				: "  audio: none",
			post.transcript
				? `  transcript: ${post.transcript.language}, ${post.transcript.provider}`
				: "  transcript: none",
			`  beats: ${beats.length}, prompts ${beats.filter((b) => b.prompt).length}, images ${beats.filter((b) => b.image).length}`,
			post.script
				? `  script: ${isScriptApproved(post) ? "approved" : "not approved"}`
				: "  script: none",
			post.draft ? `  draft: ${post.draft.file}` : "  draft: none",
			...reviewLines(post),
			`Next: ${o.next}`,
		];
		return lines.join("\n");
	},
});
