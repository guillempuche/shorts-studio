/**
 * The post manifest, `post.json`: the single source of truth for one post.
 *
 * Commands write it; a hand edit is validated on the next read. Every generated output is
 * recorded with an `inputHash`, the hash of everything it was made from, so an edit upstream
 * (a new prompt, a re-cut beat) makes it stale. The stage is computed from this record, never
 * stored: see `stageOf`.
 */

import { Schema } from "effect";

export const MANIFEST_VERSION = 1;
export const SCHEMA_URL =
	"https://raw.githubusercontent.com/guillempuche/shorts-studio/main/schemas/post.schema.json";

export const Origin = Schema.Literals(["mine", "others", "ai"]);
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

/** A paid request that was submitted but whose result isn't saved yet. */
export const Pending = Schema.Struct({
	provider: Schema.String,
	model: Schema.String,
	requestId: Schema.String,
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
	prompt: Schema.optionalKey(Schema.String),
	/** Bumped by `image generate --reroll` so the same prompt yields a new image. */
	seed: Schema.optionalKey(Schema.Int),
	image: Schema.optionalKey(BeatImage),
	pending: Schema.optionalKey(Pending),
});
export type Beat = typeof Beat.Type;

export const Post = Schema.Struct({
	$schema: Schema.optionalKey(Schema.String),
	manifestVersion: Schema.Literal(MANIFEST_VERSION),
	slug: Schema.String,
	createdAt: Schema.String,
	/** Incremented on every write; a write based on an older revision is refused. */
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
			approvedAt: Schema.optionalKey(Schema.String),
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
});
export type Post = typeof Post.Type;

export const Stage = Schema.Literals([
	"idea",
	"script-ready",
	"script-approved",
	"assets",
	"draft",
]);
export type Stage = typeof Stage.Type;

/**
 * Where a post is, from what has been recorded. Freshness of each output is checked by the
 * operations that use it; here only presence and approval count, so `post list` stays cheap.
 */
export const stageOf = (post: Post): Stage => {
	if (post.draft !== undefined) return "draft";
	const approved =
		post.script?.approvedHash !== undefined && post.script.approvedHash === post.script.hash;
	if (approved && (post.audio !== undefined || post.beats !== undefined)) return "assets";
	if (approved) return "script-approved";
	if (post.script !== undefined) return "script-ready";
	return "idea";
};
