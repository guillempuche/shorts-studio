/**
 * After the draft: the user's evening review, the finished video, where it was published, and
 * archiving. The review is the user's decision, so it is CLI-only. Saving the final file,
 * recording where it was published and archiving are bookkeeping, which an agent may do when
 * told to.
 */

import { copyFileSync, existsSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { fail, type ShortsError } from "@shorts-studio/domain/errors";
import {
	currentReview,
	Decision,
	Platform,
	type Post,
	Stage,
	stageOf,
} from "@shorts-studio/domain/post";
import { Effect, Schema } from "effect";
import { fileHash, fileStep } from "../files.ts";
import { parseBeatList, requireUser } from "../inputs.ts";
import { defineOperation, p } from "../operation.ts";
import { MediaTools } from "../ports.ts";
import { postDir, readPost, refuseArchived, updatePost } from "../post-store.ts";
import { NextFields, nextOf, nextStep, refuseUnapproved } from "./post.ts";

/** `"3:too dark;5:wrong face"` → per-beat notes. */
const parseBeatNotes = (
	value: string | undefined,
): Effect.Effect<ReadonlyArray<{ beat: number; note: string }>, ShortsError> => {
	if (value === undefined) return Effect.succeed([]);
	const notes = value
		.split(";")
		.map((part) => part.trim())
		.filter(Boolean)
		.map((part) => {
			const colon = part.indexOf(":");
			return {
				beat: Number.parseInt(part.slice(0, colon), 10),
				note: part.slice(colon + 1).trim(),
			};
		});
	return notes.every((n) => Number.isInteger(n.beat) && n.note !== "")
		? Effect.succeed(notes)
		: Effect.fail(
				fail("usage", `"${value}" isn't a list of beat notes.`, 'Use "3:too dark;5:wrong face".'),
			);
};

/** A platform may be recorded for an approved draft, a final video, or a post already published. */
const publishable = (post: Post): boolean =>
	(post.published ?? []).length > 0 ||
	post.final !== undefined ||
	currentReview(post)?.decision === "approve";

/**
 * Why the post no longer allows `command`, checked again under its lock: another command may have
 * archived it, or a new render dropped its review, after the first read.
 */
const changedMeanwhile = (
	post: Post,
	command: string,
	allowed: (post: Post) => boolean,
): ShortsError | undefined => {
	if (post.archivedAt !== undefined) {
		return fail(
			"conflict",
			`${post.slug} was archived while ${command} ran, so nothing was recorded.`,
			"An archived post no longer changes.",
		);
	}
	return allowed(post)
		? undefined
		: fail(
				"conflict",
				`${post.slug} changed while ${command} ran, so nothing was recorded.`,
				`Show what it needs now with: post show --post ${post.slug}`,
			);
};

export const postReview = defineOperation({
	name: "post_review",
	description:
		"Record the user's evening check of the current draft: approve, fix (with notes) or reject. CLI only: the decision is the user's.",
	params: {
		post: p.string("Post slug"),
		decision: p.literals(Decision.literals, "approve, fix or reject"),
		note: p.optional(p.string("What to change, or why")),
		beatNotes: p.optional(p.string('Notes per beat: "3:too dark;5:wrong face"')),
		animate: p.optional(p.string("Beats to turn into AI video later, comma-separated (e.g. 0,7)")),
	},
	output: Schema.Struct({ stage: Stage, ...NextFields }),
	surface: "cli-only",
	spends: false,
	hints: { readonly: false, destructive: false, idempotent: true, openWorld: false },
	run: Effect.fn("post_review")(function* (input, ctx) {
		yield* requireUser(ctx, `post review --post ${input.post} --decision ${input.decision}`);
		const beatNotes = yield* parseBeatNotes(input.beatNotes);
		const animate = yield* parseBeatList(input.animate);
		// Read before the post's lock: the change made under it can't ask for services.
		const before = yield* readPost(ctx, input.post);
		yield* refuseArchived(before, "post review");
		const noDraftFix = yield* nextStep(ctx, before);
		const post = yield* updatePost(ctx, input.post, "post review", (current) => {
			if (current.draft === undefined) {
				return Effect.fail(fail("not-found", `${input.post} has no draft to review.`, noDraftFix));
			}
			const known = new Set((current.beats?.items ?? []).map((b) => b.index));
			const unknown = [...beatNotes.map((n) => n.beat), ...animate].filter(
				(beat) => !known.has(beat),
			);
			if (unknown.length > 0) {
				return Effect.fail(
					fail(
						"usage",
						`No beat ${unknown.join(", ")} in ${input.post}.`,
						`See them with: post show --post ${input.post}`,
					),
				);
			}
			return Effect.succeed({
				...current,
				review: {
					decision: input.decision,
					at: ctx.now().toISOString(),
					draftHash: current.draft.hash,
					...(input.note !== undefined ? { note: input.note } : {}),
					...(beatNotes.length > 0 ? { beatNotes } : {}),
					...(animate.length > 0 ? { animate } : {}),
				},
			});
		});
		return { stage: stageOf(post), ...(yield* nextOf(ctx, post)) };
	}),
	render: (o) => `Review recorded: ${o.stage}.\nNext: ${o.next}`,
});

export const postFinalize = defineOperation({
	name: "post_finalize",
	description:
		"Record the finished video (usually exported from CapCut) as the post's final.mp4. The draft should be approved first.",
	params: {
		post: p.string("Post slug"),
		file: p.string("Path to the finished video"),
	},
	output: Schema.Struct({ file: Schema.String, durationSec: Schema.Finite, ...NextFields }),
	surface: "cli-and-mcp",
	spends: false,
	hints: { readonly: false, destructive: false, idempotent: true, openWorld: false },
	run: Effect.fn("post_finalize")(function* (input, ctx) {
		const source = resolve(input.file);
		if (!existsSync(source)) {
			return yield* fail(
				"not-found",
				`No file at ${source}.`,
				"Export the video from CapCut first, then pass its path.",
			);
		}
		const before = yield* readPost(ctx, input.post);
		yield* refuseArchived(before, "post finalize");
		const platforms = (before.published ?? []).map((entry) => entry.platform);
		if (platforms.length > 0) {
			return yield* fail(
				"conflict",
				`${input.post} is already published on ${platforms.join(", ")}, so its final video stays as it is.`,
				`Record another platform with: post publish --post ${input.post} --platform <platform> --url <url>`,
			);
		}
		// A final video replaces the one before; the first needs the user's approval.
		if (before.final === undefined) yield* refuseUnapproved(ctx, before, "post finalize");
		const finalizable = (post: Post) =>
			(post.published ?? []).length === 0 &&
			(post.final !== undefined || currentReview(post)?.decision === "approve");
		const file = `final${extname(source) || ".mp4"}`;
		const target = join(postDir(ctx, input.post), file);
		const media = yield* MediaTools;
		const durationSec = yield* media.duration(source);
		yield* fileStep(
			() => copyFileSync(source, target),
			`Check that ${target} can be written, then run it again.`,
		);
		const hash = yield* fileHash(target);
		const post = yield* updatePost(ctx, input.post, "post finalize", (current) => {
			const changed = changedMeanwhile(current, "post finalize", finalizable);
			if (changed !== undefined) return Effect.fail(changed);
			return Effect.succeed({ ...current, final: { file, hash, at: ctx.now().toISOString() } });
		});
		return { file: target, durationSec, ...(yield* nextOf(ctx, post)) };
	}),
	render: (o) => `Final video saved: ${o.file} (${o.durationSec.toFixed(1)} s)\nNext: ${o.next}`,
});

export const postPublish = defineOperation({
	name: "post_publish",
	description: "Record where the post was published (platform and URL). Run once per platform.",
	params: {
		post: p.string("Post slug"),
		platform: p.literals(Platform.literals, "Where it was published"),
		url: p.string("The post's public URL"),
	},
	output: Schema.Struct({ platforms: Schema.Array(Platform), ...NextFields }),
	surface: "cli-and-mcp",
	spends: false,
	hints: { readonly: false, destructive: false, idempotent: true, openWorld: false },
	run: Effect.fn("post_publish")(function* (input, ctx) {
		if (!/^https?:\/\//.test(input.url)) {
			return yield* fail(
				"usage",
				`"${input.url}" isn't a URL.`,
				"Pass the post's full https:// address.",
			);
		}
		// An approved draft may be published as it is; a final video, or a platform already recorded,
		// passed that check before.
		const before = yield* readPost(ctx, input.post);
		yield* refuseArchived(before, "post publish");
		if (!publishable(before)) yield* refuseUnapproved(ctx, before, "post publish");
		const post = yield* updatePost(ctx, input.post, "post publish", (current) => {
			const changed = changedMeanwhile(current, "post publish", publishable);
			if (changed !== undefined) return Effect.fail(changed);
			const others = (current.published ?? []).filter((entry) => entry.platform !== input.platform);
			return Effect.succeed({
				...current,
				published: [
					...others,
					{ platform: input.platform, url: input.url, at: ctx.now().toISOString() },
				],
			});
		});
		return {
			platforms: (post.published ?? []).map((entry) => entry.platform),
			...(yield* nextOf(ctx, post)),
		};
	}),
	render: (o) => `Published on: ${o.platforms.join(", ")}.\nNext: ${o.next}`,
});

export const postArchive = defineOperation({
	name: "post_archive",
	description:
		"Archive a post. It no longer shows in post list, unless you list by stage archived. Its files stay where they are.",
	params: { post: p.string("Post slug") },
	output: Schema.Struct({ archivedAt: Schema.String, ...NextFields }),
	surface: "cli-and-mcp",
	spends: false,
	hints: { readonly: false, destructive: false, idempotent: true, openWorld: false },
	run: Effect.fn("post_archive")(function* (input, ctx) {
		// Archiving again keeps the first time.
		const post = yield* updatePost(ctx, input.post, "post archive", (current) =>
			Effect.succeed({ ...current, archivedAt: current.archivedAt ?? ctx.now().toISOString() }),
		);
		return { archivedAt: post.archivedAt ?? "", ...(yield* nextOf(ctx, post)) };
	}),
	render: (o) => `Archived at ${o.archivedAt}.\nNext: ${o.next}`,
});
