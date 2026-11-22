/**
 * `draft render`: the draft video the user reviews, as a 1080×1920 MP4. Each beat shows its
 * image, which moves the way its story moment calls for. Captions timed to the words are burned
 * in, over the post's audio.
 *
 * It also writes `captions.srt` for CapCut desktop, beside the ASS file that ffmpeg burns in.
 * It skips the work when the draft is up to date with its audio, beats, images and captions.
 */

import { existsSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { groupCaptions, toAss, toSrt } from "@shorts-studio/domain/captions";
import { motionOf } from "@shorts-studio/domain/direction";
import { fail } from "@shorts-studio/domain/errors";
import type { Post, Word } from "@shorts-studio/domain/post";
import { Effect, Schema } from "effect";
import type { Context } from "../context.ts";
import { fileHash, fileStep, writeFileAtomic } from "../files.ts";
import { captionStyle, draftInputHash, freshnessOf } from "../freshness.ts";
import { defineOperation, p } from "../operation.ts";
import { MediaTools } from "../ports.ts";
import { postDir, readPost, refuseArchived, updatePost } from "../post-store.ts";
import { readTranscript, TRANSCRIPT_FILE } from "./audio.ts";
import { NextFields, nextOf, nextStep } from "./post.ts";

const DRAFT_FILE = "draft.mp4";

/** `beat 1`, or `beats 1, 3`. */
const beatsNamed = (beats: ReadonlyArray<number>): string =>
	beats.length === 1 ? `beat ${beats[0]}` : `beats ${beats.join(", ")}`;

/**
 * Fails before anything is written unless every part the draft shows is there and up to date, so a
 * render never shows an old image, or words from other audio. A missing image says how to make it.
 */
const checkUpToDate = (ctx: Context, post: Post) =>
	Effect.gen(function* () {
		const fresh = yield* freshnessOf(ctx, post);
		const missing = fresh.images.filter(({ why }) => why === "none" || why === "file-gone");
		if (missing.length > 0) {
			const fixes = missing.map(({ beat, imported }) =>
				imported
					? `image import --post ${post.slug} --beat ${beat} --file <image>`
					: `image generate --post ${post.slug} --beat ${beat} --dry-run`,
			);
			return yield* fail(
				"not-found",
				`${post.slug} has no image file for ${beatsNamed(missing.map(({ beat }) => beat))}, so nothing was rendered.`,
				`Make ${missing.length === 1 ? "it" : "them"} first: ${fixes.join("; ")}`,
			);
		}
		const outOfDate = [
			...(fresh.transcript === "other-audio" ? ["the transcript was made from other audio"] : []),
			...(fresh.beats === "stale"
				? [
						`the beats were cut from ${post.audio?.kind === "music" ? "earlier audio" : "an earlier transcript"}`,
					]
				: []),
			...(["changed", "pending"] as const).flatMap((why) => {
				const beats = fresh.images.filter((image) => image.why === why).map(({ beat }) => beat);
				if (beats.length === 0) return [];
				return why === "changed"
					? [`the image of ${beatsNamed(beats)} no longer matches its prompt and seed`]
					: [
							`${beatsNamed(beats)} ${beats.length === 1 ? "has" : "have"} an image request in flight, which image generate picks up without paying again`,
						];
			}),
		];
		if (outOfDate.length > 0) {
			return yield* fail(
				"stale",
				`${post.slug} can't be rendered yet: ${outOfDate.join("; ")}.`,
				yield* nextStep(ctx, post),
			);
		}
	});

export const draftRender = defineOperation({
	name: "draft_render",
	description:
		"Render the post's draft video (1080×1920, 30 fps). Each beat's image moves as its story moment calls for, with burned-in captions, the optional hook title and the audio. Also writes captions.srt for CapCut. Skips the work when the draft is up to date.",
	params: {
		post: p.string("Post slug"),
		force: p.boolean("Render again even if the draft is up to date"),
	},
	output: Schema.Struct({
		file: Schema.String,
		durationSec: Schema.Finite,
		skipped: Schema.Boolean,
		...NextFields,
	}),
	surface: "cli-and-mcp",
	spends: false,
	hints: { readonly: false, destructive: false, idempotent: true, openWorld: false },
	run: Effect.fn("draft_render")(function* (input, ctx) {
		const post = yield* readPost(ctx, input.post);
		yield* refuseArchived(post, "draft render");
		const dir = postDir(ctx, input.post);
		const beats = post.beats?.items ?? [];
		if (post.audio === undefined || beats.length === 0) {
			return yield* fail(
				"not-found",
				`${input.post} isn't ready to render: it needs audio, beats and an image for every beat.`,
				yield* nextStep(ctx, post),
			);
		}
		yield* checkUpToDate(ctx, post);
		const media = yield* MediaTools;
		const inputHash = draftInputHash(ctx, post, media.rendererVersion);
		if (
			!input.force &&
			post.draft?.inputHash === inputHash &&
			existsSync(join(dir, post.draft.file))
		) {
			return {
				file: join(dir, post.draft.file),
				durationSec: post.draft.durationSec,
				skipped: true,
				...(yield* nextOf(ctx, post)),
			};
		}

		const words: ReadonlyArray<Word> =
			post.audio.kind === "speech" && existsSync(join(dir, TRANSCRIPT_FILE))
				? (yield* readTranscript(ctx, input.post)).words
				: [];
		const groups = groupCaptions(words);
		yield* writeFileAtomic(
			join(dir, "captions.ass"),
			toAss(groups, captionStyle(ctx), post.script?.hook),
		);
		yield* writeFileAtomic(join(dir, "captions.srt"), toSrt(groups));

		const tmp = "draft.rendering.mp4";
		ctx.log(`Rendering ${beats.length} beats, ${post.audio.durationSec.toFixed(1)} s…`);
		const durationSec = yield* Effect.gen(function* () {
			yield* media.renderVideo({
				cwd: dir,
				beats: beats.map((b) => ({
					start: b.start,
					end: b.end,
					image: b.image?.file ?? "",
					motion: motionOf(b.moment, b.motion),
				})),
				audio: post.audio?.file,
				captions: "captions.ass",
				output: tmp,
			});
			yield* fileStep(
				() => renameSync(join(dir, tmp), join(dir, DRAFT_FILE)),
				`Check that ${dir} is writable, then run it again.`,
			);
			return yield* media.duration(join(dir, DRAFT_FILE));
		}).pipe(Effect.ensuring(Effect.sync(() => rmSync(join(dir, tmp), { force: true }))));

		const hash = yield* fileHash(join(dir, DRAFT_FILE));
		const updated = yield* updatePost(ctx, input.post, "draft render", (current) =>
			Effect.succeed({
				...current,
				draft: {
					file: DRAFT_FILE,
					hash,
					inputHash,
					rendererVersion: media.rendererVersion,
					durationSec,
				},
			}),
		);
		return {
			file: join(dir, DRAFT_FILE),
			durationSec,
			skipped: false,
			...(yield* nextOf(ctx, updated)),
		};
	}),
	render: (o) =>
		`${o.skipped ? "Draft is up to date" : "Rendered"}: ${o.file} (${o.durationSec.toFixed(1)} s)\nNext: ${o.next}`,
});
