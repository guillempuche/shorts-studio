/**
 * Creating, listing and showing posts. `post show` always answers "what now?" with `next`, the
 * command that moves the post forward, and `nextSteps`, the same steps as data an agent can call.
 */

import { join } from "node:path";
import {
	changesSinceApproval,
	isScriptApproved,
	type Post,
	Stage,
	stageOf,
} from "@shorts-studio/domain/post";
import { Effect, Schema } from "effect";
import { daysNow } from "../days.ts";
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

/** What to do next, given what's recorded. Approval steps are the user's. */
export const nextStepsOf = (post: Post): ReadonlyArray<NextStep> => {
	const thisPost = { post: post.slug };
	if (post.audio === undefined && post.script === undefined) {
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
	if (post.audio !== undefined && post.transcript === undefined) {
		return [agentStep("audio_transcribe", thisPost)];
	}
	if (post.transcript !== undefined && post.beats === undefined) {
		return [agentStep("beat_plan", thisPost)];
	}
	if (post.beats?.items.some((b) => b.prompt === undefined)) {
		return [
			agentStep(
				"beat_set",
				{ ...thisPost, from: "<beats.json>" },
				{
					note: "a story moment and an image prompt for every beat: see the story-direction skill",
				},
			),
		];
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
	if (post.audio === undefined) {
		return [
			agentStep("source_import", { ...thisPost, file: "<audio>", origin: "ai", kind: "speech" }),
		];
	}
	if (post.beats?.items.some((b) => b.image === undefined)) {
		// A dry run first, so the user sees the estimate; its own next step is the real run.
		return [agentStep("image_generate", { ...thisPost, dryRun: true })];
	}
	if (post.draft === undefined) return [agentStep("draft_render", thisPost)];
	switch (stageOf(post)) {
		case "draft":
			return [
				userStep(undefined, `watch ${join("<posts>", "mine", post.slug, post.draft.file)}`),
				userStep(
					`post review --post ${post.slug} --decision <decision>`,
					"approve, fix or reject: the user's evening check, CLI only",
				),
			];
		case "needs-fix":
			return [
				agentNote("apply the review notes (beat set, image generate --beat N --reroll)"),
				agentStep("draft_render", thisPost),
			];
		case "rejected":
			return [agentStep("post_archive", thisPost)];
		case "approved":
			return [
				agentStep("capcut_export", thisPost),
				userStep(undefined, "polish in CapCut desktop"),
				agentStep("post_finalize", { ...thisPost, file: "<final.mp4>" }),
			];
		case "final":
			return [
				agentStep(
					"post_publish",
					{ ...thisPost, platform: "<platform>", url: "<url>" },
					{ note: "instagram, tiktok or youtube" },
				),
			];
		case "posted":
			return [
				agentStep(
					"post_publish",
					{ ...thisPost, platform: "<another platform>", url: "<url>" },
					{ note: "for another platform" },
				),
				agentStep("post_archive", thisPost, { or: true }),
			];
		default:
			return [];
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

/** `next` and `nextSteps` for a post, as every output that moves a post on returns them. */
export const nextOf = (post: Post): { next: string; nextSteps: ReadonlyArray<NextStep> } => {
	const nextSteps = nextStepsOf(post);
	return { next: nextText(nextSteps), nextSteps };
};

/**
 * What follows a dry run: the real run when its estimate fits the caps. When it doesn't, the real
 * run would be refused (over a cap, or with a setting that can't be used), so it's the user's call.
 */
export const nextAfterDryRun = (
	budget: Budget,
	realRun: NextStep,
): { next: string; nextSteps: ReadonlyArray<NextStep> } => {
	const nextSteps = budget.fits
		? [realRun]
		: [
				userStep(
					undefined,
					`the estimate doesn't fit, so ask the user: ${budget.why ?? budget.stoppedBy}`,
				),
			];
	return { next: nextText(nextSteps), nextSteps };
};

/** The next command as text, for a `fix`. */
export const nextStep = (post: Post): string => nextOf(post).next;

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
		return { slug, dir: postDir(ctx, slug), ...nextOf(post) };
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
	run: (input, ctx) =>
		readPost(ctx, input.post).pipe(
			Effect.map((post) => ({
				slug: post.slug,
				stage: stageOf(post),
				dir: postDir(ctx, post.slug),
				...nextOf(post),
				manifest: post,
			})),
		),
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
			`Next: ${o.next}`,
		];
		return lines.join("\n");
	},
});
