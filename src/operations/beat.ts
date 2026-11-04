/**
 * Beats: the stretches of audio that each get one image.
 *
 * `beat plan` cuts them from the transcript's word timings (or an even grid for music);
 * `beat set` is how the agent writes each beat's image prompt, one at a time or all at once
 * from a JSON file, validated before anything is saved.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Effect, Schema } from "effect";
import type { Context } from "../core/context.ts";
import { fail, type ShortsError } from "../core/errors.ts";
import { hashOf } from "../core/files.ts";
import { defineOperation, p } from "../core/operation.ts";
import { postDir, readPost, updatePost } from "../core/post-store.ts";
import type { Beat, Post, Word } from "../domain/post.ts";
import { PLANNER_VERSION, planBeats } from "../work/beats.ts";
import { TRANSCRIPT_FILE } from "./audio.ts";
import { nextStep } from "./post.ts";

const readWords = (ctx: Context, post: Post): ReadonlyArray<Word> => {
	const file = join(postDir(ctx, post.slug), TRANSCRIPT_FILE);
	return existsSync(file)
		? ((JSON.parse(readFileSync(file, "utf8")) as { words: ReadonlyArray<Word> }).words ?? [])
		: [];
};

/** What the plan is made from: the transcript for speech, the audio itself for music. */
const planInputHash = (post: Post): string | undefined => {
	if (post.audio === undefined) return undefined;
	if (post.audio.kind === "music") return hashOf("music", post.audio.hash, PLANNER_VERSION);
	return post.transcript === undefined
		? undefined
		: hashOf("speech", post.transcript.hash, post.audio.durationSec, PLANNER_VERSION);
};

const BeatRow = Schema.Struct({
	index: Schema.Int,
	start: Schema.Finite,
	end: Schema.Finite,
	text: Schema.String,
	prompt: Schema.optionalKey(Schema.String),
});

export const beatPlan = defineOperation({
	name: "beat_plan",
	description:
		"Split the audio into beats of about 1.5–3 s (at word and pause boundaries for speech; an even grid for music), each to get one image. Replanning drops existing prompts, so it needs --force when the plan has prompts.",
	params: {
		post: p.string("Post slug"),
		force: p.boolean("Replace an existing plan even though its prompts will be lost"),
	},
	output: Schema.Struct({
		beats: Schema.Array(BeatRow),
		skipped: Schema.Boolean,
		next: Schema.String,
	}),
	surface: "cli-and-mcp",
	spends: false,
	hints: { readonly: false, destructive: false, idempotent: true, openWorld: false },
	run: (input, ctx) =>
		Effect.gen(function* () {
			const post = yield* readPost(ctx, input.post);
			const inputHash = planInputHash(post);
			if (post.audio === undefined || inputHash === undefined) {
				return yield* Effect.fail(
					fail(
						"not-found",
						`${input.post} needs ${post.audio === undefined ? "audio" : "a transcript"} before beats can be planned.`,
						post.audio === undefined
							? `source import --post ${input.post} …`
							: `audio transcribe --post ${input.post}`,
					),
				);
			}
			const existing = post.beats;
			if (existing !== undefined && existing.inputHash === inputHash && !input.force) {
				return { beats: existing.items.map(row), skipped: true, next: nextStep(post) };
			}
			if (existing?.items.some((b) => b.prompt !== undefined) && !input.force) {
				return yield* Effect.fail(
					fail(
						"stale",
						`The beat plan is out of date (the audio or transcript changed), and replanning drops its ${existing.items.filter((b) => b.prompt).length} prompts.`,
						`Run beat plan --post ${input.post} --force, then set the prompts again.`,
					),
				);
			}
			const spans = planBeats(
				post.audio.kind === "music" ? [] : readWords(ctx, post),
				post.audio.durationSec,
			);
			const items: ReadonlyArray<Beat> = spans.map((span) => ({ ...span }));
			const updated = yield* updatePost(ctx, input.post, "beat plan", (current) =>
				Effect.succeed({ ...current, beats: { inputHash, items } }),
			);
			return { beats: items.map(row), skipped: false, next: nextStep(updated) };
		}),
	render: (o) =>
		[
			o.skipped ? "Beat plan is up to date." : `Planned ${o.beats.length} beats.`,
			...o.beats.map(
				(b) =>
					`  ${String(b.index).padStart(2)}  ${b.start.toFixed(2).padStart(6)}–${b.end.toFixed(2).padEnd(6)} ${b.text}`,
			),
			`Next: ${o.next}`,
		].join("\n"),
});

const row = (beat: Beat): typeof BeatRow.Type => ({
	index: beat.index,
	start: beat.start,
	end: beat.end,
	text: beat.text,
	...(beat.prompt !== undefined ? { prompt: beat.prompt } : {}),
});

const BeatPatch = Schema.Struct({
	beat: Schema.Int,
	prompt: Schema.String,
});
const BeatPatches = Schema.Union([
	Schema.Array(BeatPatch),
	Schema.Struct({ beats: Schema.Array(BeatPatch) }),
]);

const readPatches = (
	file: string,
): Effect.Effect<ReadonlyArray<typeof BeatPatch.Type>, ShortsError> =>
	existsSync(file)
		? Schema.decodeUnknownEffect(Schema.fromJsonString(BeatPatches), { errors: "all" })(
				readFileSync(file, "utf8"),
			).pipe(
				Effect.map((parsed) => ("beats" in parsed ? parsed.beats : parsed)),
				Effect.mapError((error) =>
					fail(
						"usage",
						`${file} isn't a list of beat prompts:\n${error.message}`,
						'Use [{"beat": 0, "prompt": "…"}, …] or {"beats": [...]}.',
					),
				),
			)
		: Effect.fail(
				fail("not-found", `No file at ${file}.`, "Write the prompts to a JSON file first."),
			);

export const beatSet = defineOperation({
	name: "beat_set",
	description:
		'Set image prompts: one beat with --beat and --prompt, or many from a JSON file (--from) holding [{"beat": 0, "prompt": "…"}, …]. A changed prompt makes that beat\'s image stale.',
	params: {
		post: p.string("Post slug"),
		beat: p.optional(p.int("Beat index (with --prompt)")),
		prompt: p.optional(p.string("Image prompt for --beat")),
		from: p.optional(p.string('JSON file: [{"beat": 0, "prompt": "…"}, …]')),
	},
	output: Schema.Struct({
		updated: Schema.Int,
		missing: Schema.Array(Schema.Int),
		next: Schema.String,
	}),
	surface: "cli-and-mcp",
	spends: false,
	hints: { readonly: false, destructive: false, idempotent: true, openWorld: false },
	run: (input, ctx) =>
		Effect.gen(function* () {
			const patches =
				input.from !== undefined
					? yield* readPatches(input.from)
					: input.beat !== undefined && input.prompt !== undefined
						? [{ beat: input.beat, prompt: input.prompt }]
						: yield* Effect.fail(
								fail(
									"usage",
									"Nothing to set.",
									'Pass --beat N --prompt "…", or --from prompts.json.',
								),
							);
			const post = yield* updatePost(ctx, input.post, "beat set", (current) => {
				const beats = current.beats;
				if (beats === undefined) {
					return Effect.fail(
						fail(
							"not-found",
							`${input.post} has no beats yet.`,
							`Plan them first: beat plan --post ${input.post}`,
						),
					);
				}
				const unknown = patches.filter((patch) => !beats.items.some((b) => b.index === patch.beat));
				if (unknown.length > 0) {
					return Effect.fail(
						fail(
							"usage",
							`No beat ${unknown.map((u) => u.beat).join(", ")} (the plan has 0–${beats.items.length - 1}).`,
							`See them with: beat plan --post ${input.post}`,
						),
					);
				}
				const byBeat = new Map(patches.map((patch) => [patch.beat, patch.prompt.trim()]));
				return Effect.succeed({
					...current,
					beats: {
						...beats,
						items: beats.items.map((b) =>
							byBeat.has(b.index) ? { ...b, prompt: byBeat.get(b.index) as string } : b,
						),
					},
				});
			});
			const missing = (post.beats?.items ?? [])
				.filter((b) => b.prompt === undefined)
				.map((b) => b.index);
			return { updated: patches.length, missing, next: nextStep(post) };
		}),
	render: (o) =>
		`Set ${o.updated} prompt${o.updated === 1 ? "" : "s"}.${o.missing.length > 0 ? ` Still without a prompt: ${o.missing.join(", ")}.` : ""}\nNext: ${o.next}`,
});
