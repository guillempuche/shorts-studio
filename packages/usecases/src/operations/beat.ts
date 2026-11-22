/**
 * Beats: the stretches of audio that each get one image.
 *
 * `beat plan` cuts them at the transcript's word times, or on an even grid for music.
 * `beat set` is how the agent writes each beat's image prompt, one beat at a time or all at
 * once from a JSON file. The file is checked before anything is saved.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { planBeats, planByMoment, sectionsOf } from "@shorts-studio/domain/beats";
import { Moment, MotionType } from "@shorts-studio/domain/direction";
import { fail, type ShortsError } from "@shorts-studio/domain/errors";
import { type Beat, mapBeats, type Post, type Word } from "@shorts-studio/domain/post";
import { Effect, Schema } from "effect";
import type { Context } from "../context.ts";
import { readText } from "../files.ts";
import { freshnessOf, planInputHash, recutInputHash } from "../freshness.ts";
import { inputFile, RELATIVE_PATH } from "../inputs.ts";
import { closedStruct, defineOperation, p } from "../operation.ts";
import { postDir, readPost, refuseArchived, updatePost } from "../post-store.ts";
import { agentStep, BEAT_ITEM } from "../steps.ts";
import { readTranscript, TRANSCRIPT_FILE } from "./audio.ts";
import { fetchSavedFix, withImagesLock } from "./image.ts";
import { NextFields, nextOf } from "./post.ts";

/** The words to cut beats from: none for music, or before there's a transcript. */
const readWords = (ctx: Context, post: Post): Effect.Effect<ReadonlyArray<Word>, ShortsError> =>
	post.audio?.kind === "music" || !existsSync(join(postDir(ctx, post.slug), TRANSCRIPT_FILE))
		? Effect.succeed([])
		: Effect.map(readTranscript(ctx, post.slug), (transcript) => transcript.words);

/**
 * Saves a new plan, whose beats start afresh. A saved request would be lost with its paid image,
 * so it waits out a running image generate and refuses while a beat still has one.
 */
const replaceBeats = (ctx: Context, slug: string, beats: NonNullable<Post["beats"]>) =>
	withImagesLock(
		ctx,
		slug,
		"beat plan",
		updatePost(ctx, slug, "beat plan", (current) => {
			const waiting = (current.beats?.items ?? []).filter((b) => b.pending !== undefined);
			if (waiting.length === 0) return Effect.succeed({ ...current, beats });
			const one = waiting.length === 1;
			const fetch = fetchSavedFix(ctx, slug, waiting);
			return Effect.fail(
				fail(
					"conflict",
					`${one ? "Beat" : "Beats"} ${waiting.map((b) => b.index).join(", ")} ${one ? "has a request" : "have requests"} already paid for and not fetched yet, so the beat plan was kept.`,
					`Run ${fetch.cli} first: it ${fetch.what}. Then plan again.`,
				),
			);
		}),
	);

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
		yield* refuseArchived(post, "beat plan");
		const inputHash = planInputHash(post);
		if (post.audio === undefined || inputHash === undefined) {
			const thisPost = { post: input.post };
			const step =
				post.audio === undefined
					? agentStep(
							"source_import",
							{ ...thisPost, file: "<audio-or-video>", origin: "mine", kind: "speech" },
							{ note: "origin: mine, others or ai; kind: speech or music" },
						)
					: agentStep("audio_transcribe", { ...thisPost, dryRun: true });
			return yield* fail(
				"not-found",
				`${input.post} needs ${post.audio === undefined ? "audio" : "a transcript"} before beats can be planned.`,
				post.audio === undefined
					? `Import the audio first: ${step.cli}. Set origin to mine, others or ai, and kind to speech or music.`
					: `Transcribe it first: ${step.cli}`,
				[step],
			);
		}
		// Words from other audio would cut beats in the wrong places, or past the audio's end.
		const fresh = yield* freshnessOf(ctx, post);
		if (fresh.transcript === "other-audio") {
			return yield* fail(
				"stale",
				`${input.post}'s transcript was made from other audio than the post has now, so beats can't be cut from it.`,
				`Transcribe the new audio first: audio transcribe --post ${input.post} --dry-run, then beat plan --post ${input.post}`,
			);
		}
		const existing = post.beats;
		const withPrompts = existing?.items.filter((b) => b.prompt !== undefined).length ?? 0;
		const cutFrom = post.audio.kind === "music" ? "earlier audio" : "an earlier transcript";
		if (input.byMoment) {
			if (existing === undefined || existing.items.every((b) => b.moment === undefined)) {
				return yield* fail(
					"not-found",
					`${input.post} has no story moments to re-cut by.`,
					existing === undefined
						? `Plan the beats first: beat plan --post ${input.post}. Then mark their moments with beat set --post ${input.post} --beats <beats>.`
						: `Mark the beats' story moments first: beat set --post ${input.post} --beats <beats>, each as ${BEAT_ITEM}.`,
					existing === undefined
						? [agentStep("beat_plan", { post: input.post })]
						: [
								agentStep(
									"beat_set",
									{ post: input.post, beats: "<beats>" },
									{ note: `a story moment for each beat, as ${BEAT_ITEM}` },
								),
							],
				);
			}
			// The moments mark time ranges of the old words, so a re-cut of them would mean nothing.
			if (fresh.beats === "stale") {
				return yield* fail(
					"stale",
					`${input.post}'s beats were cut from ${cutFrom}, so their story moments can't be re-cut.`,
					`Plan the beats again: beat plan --post ${input.post}${withPrompts > 0 ? " --force" : ""}, then mark the moments again.`,
				);
			}
			const sections = sectionsOf(existing.items);
			const recutHash = recutInputHash(inputHash, existing.items);
			if (existing.inputHash === recutHash && !input.force) {
				return { beats: existing.items.map(row), skipped: true, ...(yield* nextOf(ctx, post)) };
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
			const updated = yield* replaceBeats(ctx, input.post, {
				inputHash: recutHash,
				sourceHash: inputHash,
				items,
			});
			return { beats: items.map(row), skipped: false, ...(yield* nextOf(ctx, updated)) };
		}
		// A current plan stays, also when it was re-cut by moment: planning again would undo the re-cut.
		if (existing !== undefined && fresh.beats === "current" && !input.force) {
			return { beats: existing.items.map(row), skipped: true, ...(yield* nextOf(ctx, post)) };
		}
		if (withPrompts > 0 && !input.force) {
			return yield* fail(
				"stale",
				`${input.post}'s beats were cut from ${cutFrom}. Planning again drops their ${withPrompts} prompt${withPrompts === 1 ? "" : "s"}.`,
				`Run beat plan --post ${input.post} --force, then set the prompts again.`,
			);
		}
		const spans = planBeats(yield* readWords(ctx, post), post.audio.durationSec);
		const items: ReadonlyArray<Beat> = spans.map((span) => ({ ...span }));
		const updated = yield* replaceBeats(ctx, input.post, {
			inputHash,
			sourceHash: inputHash,
			items,
		});
		return { beats: items.map(row), skipped: false, ...(yield* nextOf(ctx, updated)) };
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

const beatFields = {
	beat: Schema.Int,
	prompt: Schema.optionalKey(Schema.String),
	moment: Schema.optionalKey(Moment),
	motion: Schema.optionalKey(MotionType),
};
type BeatPatch = Schema.Struct.Type<typeof beatFields>;
/**
 * The beats' settings, as `--beats` and `--from` take them; a field a beat doesn't have fails.
 * Typed as plain patches: the closed struct's type adds a `never` index signature, which no
 * object built here would fit.
 */
const BeatList: Schema.Codec<ReadonlyArray<BeatPatch>, unknown> = Schema.Array(
	closedStruct(beatFields, "A beat's settings"),
);
const BeatPatches = Schema.Union([BeatList, Schema.Struct({ beats: BeatList })]);

const FORMS = `Pass the beats inline with --beats '${BEAT_ITEM}', a JSON file with --from <beats.json>, or one beat with --beat <n> and --prompt, --moment or --motion.`;

const readPatches = (path: string): Effect.Effect<ReadonlyArray<BeatPatch>, ShortsError> =>
	inputFile(path, `Write the beats to a JSON file first, or pass them inline with --beats.`).pipe(
		Effect.flatMap((file) =>
			readText(file, "Write the beats to a JSON file first.").pipe(
				Effect.flatMap((text) =>
					Schema.decodeUnknownEffect(Schema.fromJsonString(BeatPatches), { errors: "all" })(
						text,
					).pipe(
						Effect.mapError((error) =>
							fail(
								"usage",
								`${file} isn't a list of beat settings:\n${error.message}`,
								`Use ${BEAT_ITEM} or {"beats": [...]}.`,
							),
						),
					),
				),
			),
		),
		Effect.map((parsed) => ("beats" in parsed ? parsed.beats : parsed)),
	);

type BeatSetInput = {
	readonly beats: ReadonlyArray<BeatPatch> | undefined;
	readonly from: string | undefined;
	readonly beat: number | undefined;
	readonly prompt: string | undefined;
	readonly moment: BeatPatch["moment"];
	readonly motion: BeatPatch["motion"];
};

/** The settings to save, from exactly one of the three forms. */
const patchesOf = (input: BeatSetInput): Effect.Effect<ReadonlyArray<BeatPatch>, ShortsError> => {
	const anySetting =
		input.prompt !== undefined || input.moment !== undefined || input.motion !== undefined;
	const singleBeat = input.beat !== undefined || anySetting;
	const formsGiven = [input.beats !== undefined, input.from !== undefined, singleBeat].filter(
		Boolean,
	);
	if (formsGiven.length === 0) return Effect.fail(fail("usage", "Nothing to set.", FORMS));
	if (formsGiven.length > 1) {
		return Effect.fail(
			fail("usage", "--beats, --from and --beat each set beats; pass only one of them.", FORMS),
		);
	}
	if (input.beats !== undefined) return Effect.succeed(input.beats);
	if (input.from !== undefined) return readPatches(input.from);
	if (input.beat === undefined || !anySetting) {
		return Effect.fail(
			fail(
				"usage",
				input.beat === undefined ? "No beat given." : `Nothing to set on beat ${input.beat}.`,
				FORMS,
			),
		);
	}
	return Effect.succeed([
		{
			beat: input.beat,
			...(input.prompt !== undefined ? { prompt: input.prompt } : {}),
			...(input.moment !== undefined ? { moment: input.moment } : {}),
			...(input.motion !== undefined ? { motion: input.motion } : {}),
		},
	]);
};

/**
 * Refuses settings that can't be right before anything is saved: a blank prompt would count as
 * written, and a beat named twice would keep only its last settings.
 */
const checkPatches = (
	patches: ReadonlyArray<BeatPatch>,
): Effect.Effect<ReadonlyArray<BeatPatch>, ShortsError> => {
	const blank = patches.filter((patch) => patch.prompt?.trim() === "").map((patch) => patch.beat);
	if (blank.length > 0) {
		return Effect.fail(
			fail(
				"usage",
				`The prompt for beat ${blank.join(", ")} is empty.`,
				"Give each beat a prompt that describes its image, or leave prompt out to keep the one it has.",
			),
		);
	}
	const seen = new Set<number>();
	const twice = new Set<number>();
	for (const { beat } of patches) (seen.has(beat) ? twice : seen).add(beat);
	if (twice.size > 0) {
		return Effect.fail(
			fail(
				"usage",
				`Beat ${[...twice].join(", ")} is named more than once.`,
				"Name each beat once, with all its settings in one item.",
			),
		);
	}
	return Effect.succeed(patches);
};

export const beatSet = defineOperation({
	name: "beat_set",
	description: `Set beats' image prompts, story moments (hook, setup, tension, twist, vulnerable, payoff, cta) and motion overrides. Pass them inline as beats, ${BEAT_ITEM}; from a JSON file of the same shape (from); or set one beat with beat and its prompt, moment or motion. Use only one of the three. A new prompt makes that beat's image out of date. A new moment or motion makes the draft out of date.`,
	params: {
		post: p.string("Post slug"),
		beats: p.optional(
			p.json(BeatList, `The beats' settings: ${BEAT_ITEM}; each beat once, prompts not blank`),
		),
		beat: p.optional(p.int("Beat index (with --prompt, --moment or --motion)")),
		prompt: p.optional(p.string("Image prompt for --beat")),
		moment: p.optional(p.literals(Moment.literals, "Story moment for --beat")),
		motion: p.optional(
			p.literals(MotionType.literals, "Motion for --beat, used instead of its moment's motion"),
		),
		from: p.optional(
			p.string(`JSON file holding the beats' settings, like --beats; ${RELATIVE_PATH}`),
		),
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
		const patches = yield* checkPatches(yield* patchesOf(input));
		const post = yield* updatePost(ctx, input.post, "beat set", (current) => {
			if (current.archivedAt !== undefined)
				return refuseArchived(current, "beat set").pipe(Effect.as(current));
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
		return { updated: patches.length, missing, ...(yield* nextOf(ctx, post)) };
	}),
	render: (o) =>
		`Updated ${o.updated} beat${o.updated === 1 ? "" : "s"}.${o.missing.length > 0 ? ` Still without a prompt: ${o.missing.join(", ")}.` : ""}\nNext: ${o.next}`,
});
