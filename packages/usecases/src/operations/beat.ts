/**
 * Beats: the stretches of audio that each get one image.
 *
 * `beat plan` cuts them at the transcript's word times, or on an even grid for music.
 * `beat set` is how the agent writes each beat's image prompt, one beat at a time or all at
 * once from a JSON file. The file is checked before anything is saved.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { PLANNER_VERSION, planBeats, planByMoment, sectionsOf } from "@shorts-studio/domain/beats";
import { Moment, MotionType } from "@shorts-studio/domain/direction";
import { fail, type ShortsError } from "@shorts-studio/domain/errors";
import { type Beat, mapBeats, type Post, type Word } from "@shorts-studio/domain/post";
import { Effect, Schema } from "effect";
import type { Context } from "../context.ts";
import { hashOf, readText } from "../files.ts";
import { defineOperation, p } from "../operation.ts";
import { postDir, readPost, updatePost } from "../post-store.ts";
import { readTranscript, TRANSCRIPT_FILE } from "./audio.ts";
import { NextFields, nextOf } from "./post.ts";

/** The words to cut beats from: none for music, or before there's a transcript. */
const readWords = (ctx: Context, post: Post): Effect.Effect<ReadonlyArray<Word>, ShortsError> =>
	post.audio?.kind === "music" || !existsSync(join(postDir(ctx, post.slug), TRANSCRIPT_FILE))
		? Effect.succeed([])
		: Effect.map(readTranscript(ctx, post.slug), (transcript) => transcript.words);

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
	moment: Schema.optionalKey(Moment),
	motion: Schema.optionalKey(MotionType),
	prompt: Schema.optionalKey(Schema.String),
});

export const beatPlan = defineOperation({
	name: "beat_plan",
	description:
		"Split the audio into beats of about 1.5–3 s, each to get one image. Speech is cut between words and at pauses; music is cut on an even grid. With byMoment, re-cut the beats of each story moment to that moment's beat length (set the moments first with beat set). Planning again drops the existing prompts, so it needs --force when the plan has prompts.",
	params: {
		post: p.string("Post slug"),
		byMoment: p.boolean("Re-cut the beats of each story moment to that moment's beat length"),
		force: p.boolean("Replace an existing plan even though its prompts will be lost"),
	},
	output: Schema.Struct({
		beats: Schema.Array(BeatRow),
		skipped: Schema.Boolean,
		...NextFields,
	}),
	surface: "cli-and-mcp",
	spends: false,
	hints: { readonly: false, destructive: false, idempotent: true, openWorld: false },
	run: Effect.fn("beat_plan")(function* (input, ctx) {
		const post = yield* readPost(ctx, input.post);
		const inputHash = planInputHash(post);
		if (post.audio === undefined || inputHash === undefined) {
			return yield* fail(
				"not-found",
				`${input.post} needs ${post.audio === undefined ? "audio" : "a transcript"} before beats can be planned.`,
				post.audio === undefined
					? `source import --post ${input.post} …`
					: `audio transcribe --post ${input.post}`,
			);
		}
		const existing = post.beats;
		if (input.byMoment) {
			if (existing === undefined || existing.items.every((b) => b.moment === undefined)) {
				return yield* fail(
					"not-found",
					`${input.post} has no story moments to re-cut by.`,
					`Plan beats, then mark moments: beat set --post ${input.post} --from moments.json`,
				);
			}
			const sections = sectionsOf(existing.items);
			const recutHash = hashOf("by-moment", inputHash, sections);
			if (existing.inputHash === recutHash && !input.force) {
				return { beats: existing.items.map(row), skipped: true, ...nextOf(post) };
			}
			if (existing.items.some((b) => b.prompt !== undefined) && !input.force) {
				return yield* fail(
					"stale",
					`Re-cutting by moment drops the plan's ${existing.items.filter((b) => b.prompt).length} prompts.`,
					`Run beat plan --post ${input.post} --by-moment --force, then set the prompts again.`,
				);
			}
			const spans = planByMoment(yield* readWords(ctx, post), sections);
			const items: ReadonlyArray<Beat> = spans.map((span) => ({ ...span }));
			const updated = yield* updatePost(ctx, input.post, "beat plan", (current) =>
				Effect.succeed({ ...current, beats: { inputHash: recutHash, items } }),
			);
			return { beats: items.map(row), skipped: false, ...nextOf(updated) };
		}
		if (existing !== undefined && existing.inputHash === inputHash && !input.force) {
			return { beats: existing.items.map(row), skipped: true, ...nextOf(post) };
		}
		if (existing?.items.some((b) => b.prompt !== undefined) && !input.force) {
			return yield* fail(
				"stale",
				`The beat plan is out of date because the audio or transcript changed. Planning again drops its ${existing.items.filter((b) => b.prompt).length} prompts.`,
				`Run beat plan --post ${input.post} --force, then set the prompts again.`,
			);
		}
		const spans = planBeats(yield* readWords(ctx, post), post.audio.durationSec);
		const items: ReadonlyArray<Beat> = spans.map((span) => ({ ...span }));
		const updated = yield* updatePost(ctx, input.post, "beat plan", (current) =>
			Effect.succeed({ ...current, beats: { inputHash, items } }),
		);
		return { beats: items.map(row), skipped: false, ...nextOf(updated) };
	}),
	render: (o) =>
		[
			o.skipped ? "Beat plan is up to date." : `Planned ${o.beats.length} beats.`,
			...o.beats.map(
				(b) =>
					`  ${String(b.index).padStart(2)}  ${b.start.toFixed(2).padStart(6)}–${b.end.toFixed(2).padEnd(6)} ${(b.moment ?? "").padEnd(10)} ${b.text}`,
			),
			`Next: ${o.next}`,
		].join("\n"),
});

const row = (beat: Beat): typeof BeatRow.Type => ({
	index: beat.index,
	start: beat.start,
	end: beat.end,
	text: beat.text,
	...(beat.moment !== undefined ? { moment: beat.moment } : {}),
	...(beat.motion !== undefined ? { motion: beat.motion } : {}),
	...(beat.prompt !== undefined ? { prompt: beat.prompt } : {}),
});

const BeatPatch = Schema.Struct({
	beat: Schema.Int,
	prompt: Schema.optionalKey(Schema.String),
	moment: Schema.optionalKey(Moment),
	motion: Schema.optionalKey(MotionType),
});
type BeatPatch = typeof BeatPatch.Type;
const BeatPatches = Schema.Union([
	Schema.Array(BeatPatch),
	Schema.Struct({ beats: Schema.Array(BeatPatch) }),
]);

const readPatches = (file: string): Effect.Effect<ReadonlyArray<BeatPatch>, ShortsError> =>
	existsSync(file)
		? readText(file, "Write the prompts to a JSON file first.").pipe(
				Effect.flatMap((text) =>
					Schema.decodeUnknownEffect(Schema.fromJsonString(BeatPatches), { errors: "all" })(
						text,
					).pipe(
						Effect.mapError((error) =>
							fail(
								"usage",
								`${file} isn't a list of beat settings:\n${error.message}`,
								'Use [{"beat": 0, "moment": "hook", "prompt": "…"}, …] or {"beats": [...]}.',
							),
						),
					),
				),
				Effect.map((parsed) => ("beats" in parsed ? parsed.beats : parsed)),
			)
		: Effect.fail(
				fail("not-found", `No file at ${file}.`, "Write the prompts to a JSON file first."),
			);

export const beatSet = defineOperation({
	name: "beat_set",
	description:
		'Set beats\' image prompts, story moments (hook, setup, tension, twist, vulnerable, payoff, cta) and motion overrides. Set one beat with --beat, or many from a JSON file (--from) holding [{"beat": 0, "moment": "hook", "prompt": "…"}, …]. A new prompt makes that beat\'s image out of date. A new moment or motion makes the draft out of date.',
	params: {
		post: p.string("Post slug"),
		beat: p.optional(p.int("Beat index (with --prompt, --moment or --motion)")),
		prompt: p.optional(p.string("Image prompt for --beat")),
		moment: p.optional(p.literals(Moment.literals, "Story moment for --beat")),
		motion: p.optional(
			p.literals(MotionType.literals, "Motion for --beat, used instead of its moment's motion"),
		),
		from: p.optional(p.string('JSON file: [{"beat": 0, "moment": "hook", "prompt": "…"}, …]')),
	},
	output: Schema.Struct({
		updated: Schema.Int,
		missing: Schema.Array(Schema.Int),
		...NextFields,
	}),
	surface: "cli-and-mcp",
	spends: false,
	hints: { readonly: false, destructive: false, idempotent: true, openWorld: false },
	run: Effect.fn("beat_set")(function* (input, ctx) {
		const patches =
			input.from !== undefined
				? yield* readPatches(input.from)
				: input.beat !== undefined &&
						(input.prompt !== undefined || input.moment !== undefined || input.motion !== undefined)
					? [
							{
								beat: input.beat,
								...(input.prompt !== undefined ? { prompt: input.prompt } : {}),
								...(input.moment !== undefined ? { moment: input.moment } : {}),
								...(input.motion !== undefined ? { motion: input.motion } : {}),
							},
						]
					: yield* fail(
							"usage",
							"Nothing to set.",
							'Pass --beat N with --prompt "…", --moment or --motion, or --from beats.json.',
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
			const byBeat = new Map(patches.map((patch) => [patch.beat, patch]));
			const apply = (b: Beat): Beat => {
				const patch = byBeat.get(b.index);
				if (patch === undefined) return b;
				return {
					...b,
					...(patch.prompt !== undefined ? { prompt: patch.prompt.trim() } : {}),
					...(patch.moment !== undefined ? { moment: patch.moment } : {}),
					...(patch.motion !== undefined ? { motion: patch.motion } : {}),
				};
			};
			return Effect.succeed(mapBeats(current, apply));
		});
		const missing = (post.beats?.items ?? [])
			.filter((b) => b.prompt === undefined)
			.map((b) => b.index);
		return { updated: patches.length, missing, ...nextOf(post) };
	}),
	render: (o) =>
		`Updated ${o.updated} beat${o.updated === 1 ? "" : "s"}.${o.missing.length > 0 ? ` Still without a prompt: ${o.missing.join(", ")}.` : ""}\nNext: ${o.next}`,
});
