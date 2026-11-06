/**
 * After the draft: the user's evening review, the finished video, where it was published, and
 * archiving. The review is the user's decision, so it is CLI-only. Saving the final file,
 * recording where it was published and archiving are bookkeeping, which an agent may do when
 * told to.
 */

import { copyFileSync, existsSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { Effect, Schema } from "effect";
import { attempt, failWith } from "../core/attempt.ts";
import { fail, type ShortsError } from "../core/errors.ts";
import { hashFile } from "../core/files.ts";
import { parseBeatList } from "../core/inputs.ts";
import { defineOperation, p } from "../core/operation.ts";
import { postDir, readPost, updatePost } from "../core/post-store.ts";
import { Decision, Platform, Stage, stageOf } from "../domain/post.ts";
import { probeDuration } from "../work/media.ts";
import { nextStep } from "./post.ts";

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
	output: Schema.Struct({ stage: Stage, next: Schema.String }),
	surface: "cli-only",
	spends: false,
	hints: { readonly: false, destructive: false, idempotent: true, openWorld: false },
	run: (input, ctx) =>
		Effect.gen(function* () {
			const beatNotes = yield* parseBeatNotes(input.beatNotes);
			const animate = yield* parseBeatList(input.animate);
			const post = yield* updatePost(ctx, input.post, "post review", (current) => {
				if (current.draft === undefined) {
					return Effect.fail(
						fail("not-found", `${input.post} has no draft to review.`, nextStep(current)),
					);
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
			return { stage: stageOf(post), next: nextStep(post) };
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
	output: Schema.Struct({ file: Schema.String, durationSec: Schema.Finite, next: Schema.String }),
	surface: "cli-and-mcp",
	spends: false,
	hints: { readonly: false, destructive: false, idempotent: true, openWorld: false },
	run: (input, ctx) =>
		Effect.gen(function* () {
			const source = resolve(input.file);
			if (!existsSync(source)) {
				return yield* fail(
					"not-found",
					`No file at ${source}.`,
					"Export the video from CapCut first, then pass its path.",
				);
			}
			const before = yield* readPost(ctx, input.post);
			if (stageOf(before) !== "approved" && stageOf(before) !== "final") {
				return yield* fail(
					"needs-confirmation",
					`${input.post} is at "${stageOf(before)}", not approved.`,
					`The user reviews the draft first: post review --post ${input.post} --decision approve`,
				);
			}
			const file = `final${extname(source) || ".mp4"}`;
			const target = join(postDir(ctx, input.post), file);
			const { hash, durationSec } = yield* attempt(
				async (signal) => {
					const durationSec = await probeDuration(ctx, source, signal);
					copyFileSync(source, target);
					return { hash: await hashFile(target), durationSec };
				},
				failWith("failed", "Check that the file is a video ffprobe can read."),
			);
			const post = yield* updatePost(ctx, input.post, "post finalize", (current) =>
				Effect.succeed({ ...current, final: { file, hash, at: ctx.now().toISOString() } }),
			);
			return { file: target, durationSec, next: nextStep(post) };
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
	output: Schema.Struct({ platforms: Schema.Array(Platform), next: Schema.String }),
	surface: "cli-and-mcp",
	spends: false,
	hints: { readonly: false, destructive: false, idempotent: true, openWorld: false },
	run: (input, ctx) =>
		Effect.gen(function* () {
			if (!/^https?:\/\//.test(input.url)) {
				return yield* fail(
					"usage",
					`"${input.url}" isn't a URL.`,
					"Pass the post's full https:// address.",
				);
			}
			const post = yield* updatePost(ctx, input.post, "post publish", (current) => {
				const others = (current.published ?? []).filter(
					(entry) => entry.platform !== input.platform,
				);
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
				next: nextStep(post),
			};
		}),
	render: (o) => `Published on: ${o.platforms.join(", ")}.\nNext: ${o.next}`,
});

export const postArchive = defineOperation({
	name: "post_archive",
	description:
		"Archive a post. It no longer shows in post list, unless you list by stage archived. Its files stay where they are.",
	params: { post: p.string("Post slug") },
	output: Schema.Struct({ archivedAt: Schema.String }),
	surface: "cli-and-mcp",
	spends: false,
	hints: { readonly: false, destructive: false, idempotent: true, openWorld: false },
	run: (input, ctx) =>
		Effect.gen(function* () {
			const archivedAt = ctx.now().toISOString();
			yield* updatePost(ctx, input.post, "post archive", (current) =>
				Effect.succeed({ ...current, archivedAt: current.archivedAt ?? archivedAt }),
			);
			return { archivedAt };
		}),
	render: (o) => `Archived at ${o.archivedAt}.`,
});
