/**
 * `post.json`: the one file that records everything about a post.
 *
 * Commands write it; a hand edit is checked on the next read. Every generated output is saved
 * with an `inputHash`, the hash of everything it was made from. A change to any of those
 * inputs (a new prompt, a re-cut beat) then marks it stale. The stage is worked out from this
 * file, never stored: see `stageOf`.
 */

import { Schema } from "effect";
import { Moment, MotionType } from "./direction.ts";

export const MANIFEST_VERSION = 1;
export const SCHEMA_URL =
	"https://raw.githubusercontent.com/guillempuche/shorts-studio/main/schemas/post.schema.json";

export const Origin = Schema.Literals(["mine", "others", "ai"]);
export const Decision = Schema.Literals(["approve", "fix", "reject"]);
export const Platform = Schema.Literals(["instagram", "tiktok", "youtube", "other"]);
export const Kind = Schema.Literals(["speech", "music"]);

const Generated = {
	file: Schema.String,
	hash: Schema.String,
	inputHash: Schema.String,
};

export const Word = Schema.Struct({
	text: Schema.String,
	start: Schema.Finite,
	end: Schema.Finite,
});
export type Word = typeof Word.Type;

/** What a transcription returns, and what `transcript.json` holds: language, text, word timings. */
export const Transcript = Schema.Struct({
	language: Schema.String,
	text: Schema.String,
	words: Schema.Array(Word),
});
export type Transcript = typeof Transcript.Type;

/** A paid request that was submitted but whose result isn't saved yet. */
export const Pending = Schema.Struct({
	provider: Schema.String,
	model: Schema.String,
	requestId: Schema.String,
	/** Saved from the submit reply, so running again checks this request instead of paying again. */
	statusUrl: Schema.String,
	responseUrl: Schema.String,
	inputHash: Schema.String,
	seed: Schema.Int,
	ledgerId: Schema.String,
});

export const BeatImage = Schema.Struct({
	...Generated,
	provider: Schema.String,
	model: Schema.String,
	seed: Schema.Int,
	source: Schema.Literals(["generated", "imported"]),
});

export const Beat = Schema.Struct({
	index: Schema.Int,
	start: Schema.Finite,
	end: Schema.Finite,
	text: Schema.String,
	/** The story moment: sets the beat's length range and default motion (direction.ts). */
	moment: Schema.optionalKey(Moment),
	/** Replaces the moment's motion type. */
	motion: Schema.optionalKey(MotionType),
	prompt: Schema.optionalKey(Schema.String),
	/** Changed by `image generate --reroll`, so the same prompt gives a new image. */
	seed: Schema.optionalKey(Schema.Int),
	image: Schema.optionalKey(BeatImage),
	pending: Schema.optionalKey(Pending),
});
export type Beat = typeof Beat.Type;

/** A post's folder name, which is also its slug: lowercase letters, digits and dashes. */
export const Slug = Schema.String.check(Schema.isPattern(/^[a-z0-9][a-z0-9-]{0,99}$/u));

export const Post = Schema.Struct({
	$schema: Schema.optionalKey(Schema.String),
	manifestVersion: Schema.Literal(MANIFEST_VERSION),
	slug: Slug,
	createdAt: Schema.String,
	/** Goes up by one on every write. Each write re-reads the file under the post's lock first. */
	revision: Schema.Int,
	brief: Schema.optionalKey(
		Schema.Struct({
			title: Schema.optionalKey(Schema.String),
			notes: Schema.optionalKey(Schema.String),
		}),
	),
	script: Schema.optionalKey(
		Schema.Struct({
			file: Schema.String,
			hash: Schema.String,
			/** The script hash that was approved; a later edit needs a new approval. */
			approvedHash: Schema.optionalKey(Schema.String),
			/** The audio hash when it was approved, if there was audio. New audio needs approving. */
			approvedAudio: Schema.optionalKey(Schema.String),
			/** Each beat's image prompt as approved, in order ("" for none). */
			approvedPrompts: Schema.optionalKey(Schema.Array(Schema.String)),
			approvedAt: Schema.optionalKey(Schema.String),
			/** On-screen title for the first seconds of the draft (3–7 words). */
			hook: Schema.optionalKey(Schema.String),
		}),
	),
	audio: Schema.optionalKey(
		Schema.Struct({
			file: Schema.String,
			hash: Schema.String,
			origin: Origin,
			kind: Kind,
			durationSec: Schema.Finite,
			source: Schema.String,
		}),
	),
	transcript: Schema.optionalKey(
		Schema.Struct({
			...Generated,
			provider: Schema.String,
			model: Schema.String,
			language: Schema.String,
		}),
	),
	beats: Schema.optionalKey(
		Schema.Struct({
			inputHash: Schema.String,
			items: Schema.Array(Beat),
		}),
	),
	draft: Schema.optionalKey(
		Schema.Struct({
			...Generated,
			rendererVersion: Schema.Int,
			durationSec: Schema.Finite,
		}),
	),
	aiGenerated: Schema.optionalKey(Schema.Boolean),
	/** The user's evening check of the draft whose hash it names. */
	review: Schema.optionalKey(
		Schema.Struct({
			decision: Decision,
			at: Schema.String,
			draftHash: Schema.String,
			note: Schema.optionalKey(Schema.String),
			beatNotes: Schema.optionalKey(
				Schema.Array(Schema.Struct({ beat: Schema.Int, note: Schema.String })),
			),
			/** Beats the user chose to turn into AI video; no command generates video yet. */
			animate: Schema.optionalKey(Schema.Array(Schema.Int)),
		}),
	),
	/** The finished video, after polishing (usually in CapCut). */
	final: Schema.optionalKey(
		Schema.Struct({ file: Schema.String, hash: Schema.String, at: Schema.String }),
	),
	published: Schema.optionalKey(
		Schema.Array(Schema.Struct({ platform: Platform, url: Schema.String, at: Schema.String })),
	),
	archivedAt: Schema.optionalKey(Schema.String),
});
export type Post = typeof Post.Type;

export const Stage = Schema.Literals([
	"idea",
	"script-ready",
	"script-approved",
	"assets",
	"draft",
	"needs-fix",
	"rejected",
	"approved",
	"final",
	"posted",
	"archived",
]);
export type Stage = typeof Stage.Type;

/** Each beat's image prompt, in order, as an approval records them. */
const promptsOf = (post: Post): ReadonlyArray<string> =>
	(post.beats?.items ?? []).map((b) => b.prompt ?? "");

/**
 * What `script approve` records: the script, the audio and every beat's image prompt, so images
 * are made only from what the user read. Kept as values, not one hash, so the domain needs no
 * hashing and `post.json` shows what was approved.
 */
export const approvalOf = (post: Post) => ({
	approvedHash: post.script?.hash ?? "",
	...(post.audio === undefined ? {} : { approvedAudio: post.audio.hash }),
	approvedPrompts: promptsOf(post),
});

/** What changed since the script was approved, in words for `next`; empty while it holds. */
export const changesSinceApproval = (post: Post): ReadonlyArray<string> => {
	const script = post.script;
	if (script?.approvedHash === undefined) return [];
	const changes: Array<string> = [];
	if (script.approvedHash !== script.hash) changes.push("the script");
	if (script.approvedAudio !== post.audio?.hash) changes.push("the audio");
	const approved = script.approvedPrompts ?? [];
	const current = promptsOf(post);
	if (approved.length !== current.length) {
		changes.push("the beats");
	} else {
		const reprompted = (post.beats?.items ?? []).flatMap((b, i) =>
			current[i] === approved[i] ? [] : [b.index],
		);
		if (reprompted.length > 0) {
			changes.push(
				reprompted.length === 1
					? `the prompt of beat ${reprompted[0]}`
					: `the prompts of beats ${reprompted.join(", ")}`,
			);
		}
	}
	return changes;
};

/** The user approved the script, and nothing images are made from changed since. */
export const isScriptApproved = (post: Post): boolean =>
	post.script?.approvedHash !== undefined && changesSinceApproval(post).length === 0;

/** The review counts only for the draft it was made on; a new render needs a new review. */
export const currentReview = (post: Post) =>
	post.review !== undefined && post.draft !== undefined && post.review.draftHash === post.draft.hash
		? post.review
		: undefined;

/**
 * Where a post is, from what has been recorded. Only what exists and what was decided counts
 * here. The operations that use each output check whether it's still up to date, so
 * `post list` stays fast.
 */
export const stageOf = (post: Post): Stage => {
	if (post.archivedAt !== undefined) return "archived";
	if ((post.published?.length ?? 0) > 0) return "posted";
	if (post.final !== undefined) return "final";
	const review = currentReview(post);
	if (review?.decision === "approve") return "approved";
	if (review?.decision === "fix") return "needs-fix";
	if (review?.decision === "reject") return "rejected";
	if (post.draft !== undefined) return "draft";
	const approved = isScriptApproved(post);
	if (approved && (post.audio !== undefined || post.beats !== undefined)) return "assets";
	if (approved) return "script-approved";
	if (post.script !== undefined) return "script-ready";
	return "idea";
};
