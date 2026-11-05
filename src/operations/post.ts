/**
 * Creating, listing and showing posts. `post show` always answers "what now?" with `next`: the
 * exact command that moves the post forward.
 */

import { join } from "node:path";
import { Effect, Schema } from "effect";
import type { Context } from "../core/context.ts";
import { defineOperation, p } from "../core/operation.ts";
import { createPost, listSlugs, postDir, readPost } from "../core/post-store.ts";
import { type Post, Stage, stageOf } from "../domain/post.ts";

const DATED = /^\d{4}-\d{2}-\d{2}-/;

/** The command to run next, given what's recorded. Approval steps are the user's. */
export const nextStep = (post: Post): string => {
	const s = post.slug;
	if (post.audio === undefined && post.script === undefined) {
		return `source import --post ${s} --file <audio-or-video> --origin mine --kind speech   (or: script set --post ${s} --file script.md)`;
	}
	if (post.audio !== undefined && post.transcript === undefined)
		return `audio transcribe --post ${s}`;
	if (post.transcript !== undefined && post.beats === undefined) return `beat plan --post ${s}`;
	if (post.beats?.items.some((b) => b.prompt === undefined)) {
		return `beat set --post ${s} --from <beats.json>   (a story moment and an image prompt for every beat: see the story-direction skill)`;
	}
	if (post.script === undefined) return `script set --post ${s} --file script.md`;
	if (post.script.approvedHash !== post.script.hash) {
		return `script approve --post ${s}   (the user's morning check: CLI only)`;
	}
	if (post.audio === undefined)
		return `source import --post ${s} --file <audio> --origin ai --kind speech`;
	if (post.beats?.items.some((b) => b.image === undefined)) {
		return `image generate --post ${s} --yes`;
	}
	if (post.draft === undefined) return `draft render --post ${s}`;
	switch (stageOf(post)) {
		case "draft":
			return `watch ${join("<posts>", "mine", s, post.draft.file)}, then: post review --post ${s} --decision approve|fix|reject   (the user's evening check: CLI only)`;
		case "needs-fix":
			return `apply the review notes (beat set, image generate --beat N --reroll), then draft render --post ${s}`;
		case "rejected":
			return `post archive --post ${s}`;
		case "approved":
			return `capcut export --post ${s}, polish in CapCut desktop, then post finalize --post ${s} --file <final.mp4>`;
		case "final":
			return `post publish --post ${s} --platform instagram|tiktok|youtube --url <url>`;
		case "posted":
			return `post publish for another platform, or post archive --post ${s}`;
		default:
			return "nothing: the post is archived";
	}
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

const today = (ctx: Context): string => ctx.now().toISOString().slice(0, 10);

export const postCreate = defineOperation({
	name: "post_create",
	description:
		"Create a post folder. The slug gets today's date in front unless it already starts with one; the result names the final slug.",
	params: {
		post: p.string("Slug for the post, e.g. morning-routine"),
		title: p.optional(p.string("Working title")),
		notes: p.optional(p.string("Brief: idea, angle, audience, references")),
	},
	output: Schema.Struct({ slug: Schema.String, dir: Schema.String, next: Schema.String }),
	surface: "cli-and-mcp",
	spends: false,
	hints: { readonly: false, destructive: false, idempotent: false, openWorld: false },
	run: (input, ctx) =>
		Effect.gen(function* () {
			const slug = DATED.test(input.post) ? input.post : `${today(ctx)}-${input.post}`;
			const brief = {
				...(input.title !== undefined ? { title: input.title } : {}),
				...(input.notes !== undefined ? { notes: input.notes } : {}),
			};
			const post = yield* createPost(ctx, {
				slug,
				createdAt: ctx.now().toISOString(),
				...(Object.keys(brief).length > 0 ? { brief } : {}),
				aiGenerated: true,
			});
			return { slug, dir: postDir(ctx, slug), next: nextStep(post) };
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
		Effect.forEach(listSlugs(ctx), (slug) => readPost(ctx, slug)).pipe(
			Effect.map((posts) => ({
				// Archived posts show only when asked for by stage.
				posts: posts
					.map(summary)
					.filter((post) =>
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
	description: "Show a post's manifest, its stage and the next command to run.",
	params: { post: p.string("Post slug") },
	output: Schema.Struct({
		slug: Schema.String,
		stage: Stage,
		dir: Schema.String,
		next: Schema.String,
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
				next: nextStep(post),
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
				? `  script: ${post.script.approvedHash === post.script.hash ? "approved" : "not approved"}`
				: "  script: none",
			post.draft ? `  draft: ${post.draft.file}` : "  draft: none",
			`Next: ${o.next}`,
		];
		return lines.join("\n");
	},
});
