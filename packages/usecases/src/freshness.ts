/**
 * Whether each output of a post still matches the post's own inputs: the audio for a transcript,
 * the transcript (or the audio, for music) for beats, a beat's prompt and seed for its image, and
 * `draft render`'s own rule for the draft. Next steps and the commands that use an output ask here.
 *
 * A new provider, model or brand style doesn't count: the commands that make outputs keep their
 * own hash rules, so nothing already paid for is sent back to be made again.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { PLANNER_VERSION, sectionsOf } from "@shorts-studio/domain/beats";
import { DEFAULT_CAPTION_STYLE } from "@shorts-studio/domain/captions";
import { IMAGE_SIZE } from "@shorts-studio/domain/direction";
import type { Beat, Post } from "@shorts-studio/domain/post";
import { Effect } from "effect";
import type { Context } from "./context.ts";
import { hashOf } from "./files.ts";
import { MediaTools } from "./ports.ts";
import { postDir } from "./post-store.ts";

// 2^31 - 1: seeds stay within a signed 32-bit integer.
const SEED_LIMIT = 2_147_483_647;

/** A fixed default seed for each beat, so running again without --reroll gives the same image. */
const defaultSeed = (slug: string, index: number): number =>
	Number.parseInt(hashOf(slug, index).slice(0, 8), 16) % SEED_LIMIT;

/** The seed a beat's image is made with: its own, else its default. */
export const seedOf = (slug: string, beat: Beat): number =>
	beat.seed ?? defaultSeed(slug, beat.index);

/** The seed a reroll makes a beat's image with. */
export const rerolledSeed = (slug: string, beat: Beat): number =>
	(seedOf(slug, beat) + 1) % SEED_LIMIT;

/** A beat's prompt with the brand's style after it, as it's sent. */
export const fullPrompt = (ctx: Context, prompt: string): string => {
	const suffix = ctx.brand.imagePrompt?.suffix?.trim();
	return suffix ? `${prompt}, ${suffix}` : prompt;
};

/**
 * Hashes the model's name, as earlier versions did: hashing anything else would make saved
 * images look out of date, and they would be paid for again. Beats without a prompt are always
 * skipped, so the empty fallback is never sent.
 */
export const imageInputHash = (ctx: Context, modelName: string, beat: Beat, seed: number) =>
	hashOf(fullPrompt(ctx, beat.prompt ?? ""), modelName, seed, IMAGE_SIZE);

/** What the plan is made from: the transcript for speech, the audio itself for music. */
export const planInputHash = (post: Post): string | undefined => {
	if (post.audio === undefined) return undefined;
	if (post.audio.kind === "music") return hashOf("music", post.audio.hash, PLANNER_VERSION);
	return post.transcript === undefined
		? undefined
		: hashOf("speech", post.transcript.hash, post.audio.durationSec, PLANNER_VERSION);
};

/** What a re-cut by moment of a plan cut from `planHash` records. */
export const recutInputHash = (planHash: string, beats: ReadonlyArray<Beat>): string =>
	hashOf("by-moment", planHash, sectionsOf(beats));

export const captionStyle = (ctx: Context) => ({
	font: ctx.config.captions?.font ?? DEFAULT_CAPTION_STYLE.font,
	fontSize: ctx.config.captions?.fontSize ?? DEFAULT_CAPTION_STYLE.fontSize,
	highlight: ctx.config.captions?.highlight ?? DEFAULT_CAPTION_STYLE.highlight,
});

export const draftInputHash = (ctx: Context, post: Post, rendererVersion: number): string =>
	hashOf(
		post.audio?.hash,
		post.audio?.kind,
		post.transcript?.hash,
		(post.beats?.items ?? []).map((b) => [b.start, b.end, b.image?.hash, b.moment, b.motion]),
		post.script?.hook,
		captionStyle(ctx),
		rendererVersion,
	);

/** Why a beat's image needs work: none yet, made from another prompt or seed, in flight, or lost. */
export type ImageWhy = "none" | "changed" | "pending" | "file-gone";

export interface Freshness {
	/** For speech only: music is always `none`, since nothing uses its transcript. */
	readonly transcript: "none" | "current" | "other-audio";
	readonly beats: "none" | "current" | "stale";
	/** The beats are a re-cut of their current moments. */
	readonly recut: boolean;
	/** Only the beats whose image needs work. */
	readonly images: ReadonlyArray<{
		readonly beat: number;
		readonly imported: boolean;
		readonly why: ImageWhy;
	}>;
	/** What `draft render` would do: nothing while `current`. */
	readonly draft: "none" | "current" | "stale";
	/** What `capcut export` checks: the draft was rendered from the beats as they are now. */
	readonly exportMatches: boolean;
}

/** A post whose every output is up to date. */
export const UP_TO_DATE: Freshness = {
	transcript: "current",
	beats: "current",
	recut: false,
	images: [],
	draft: "current",
	exportMatches: true,
};

const transcriptOf = (post: Post): Freshness["transcript"] => {
	const { audio, transcript } = post;
	if (audio === undefined || audio.kind === "music" || transcript === undefined) return "none";
	if (transcript.audioHash !== undefined) {
		return transcript.audioHash === audio.hash ? "current" : "other-audio";
	}
	// Older transcripts: the language asked for isn't stored, so both it and detection are tried.
	const madeFrom = (language: string) =>
		hashOf(audio.hash, transcript.provider, transcript.model, language);
	return transcript.inputHash === madeFrom("auto") ||
		transcript.inputHash === madeFrom(transcript.language)
		? "current"
		: "other-audio";
};

const beatsOf = (post: Post): Pick<Freshness, "beats" | "recut"> => {
	const beats = post.beats;
	if (beats === undefined) return { beats: "none", recut: false };
	const plan = planInputHash(post);
	const recut = plan !== undefined && beats.inputHash === recutInputHash(plan, beats.items);
	if (beats.sourceHash !== undefined) {
		return { beats: beats.sourceHash === plan ? "current" : "stale", recut };
	}
	// Older plans: a plain plan or a re-cut of its current moments. A plan with moments next to an
	// older transcript counts too, since an edited re-cut can't be told from a stale plan then.
	const olderRecut =
		post.transcript !== undefined &&
		post.transcript.audioHash === undefined &&
		beats.items.some((b) => b.moment !== undefined);
	return {
		beats: beats.inputHash === plan || recut || olderRecut ? "current" : "stale",
		recut,
	};
};

const imageWhy = (ctx: Context, post: Post, beat: Beat): ImageWhy | undefined => {
	if (beat.pending !== undefined) return "pending";
	const image = beat.image;
	if (image === undefined) return "none";
	if (!existsSync(join(postDir(ctx, post.slug), image.file))) return "file-gone";
	if (image.source === "imported") return undefined;
	const seed = seedOf(post.slug, beat);
	// Older images don't record their prompt: their hash with today's brand style stands in for it.
	const sameInputs =
		image.prompt === undefined
			? image.inputHash === imageInputHash(ctx, image.model, beat, seed)
			: image.prompt === beat.prompt && image.seed === seed;
	return sameInputs ? undefined : "changed";
};

/** Whether each of `post`'s outputs still matches the post's own inputs. */
export const freshnessOf = (ctx: Context, post: Post) =>
	Effect.gen(function* () {
		const media = yield* MediaTools;
		const images = (post.beats?.items ?? []).flatMap((beat) => {
			const why = imageWhy(ctx, post, beat);
			return why === undefined
				? []
				: [{ beat: beat.index, imported: beat.image?.source === "imported", why }];
		});
		const draft = post.draft;
		const exportMatches =
			draft !== undefined && draft.inputHash === draftInputHash(ctx, post, media.rendererVersion);
		const freshness: Freshness = {
			transcript: transcriptOf(post),
			...beatsOf(post),
			images,
			draft:
				draft === undefined
					? "none"
					: exportMatches && existsSync(join(postDir(ctx, post.slug), draft.file))
						? "current"
						: "stale",
			exportMatches,
		};
		return freshness;
	});
