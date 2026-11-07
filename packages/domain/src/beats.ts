/**
 * Splitting audio into beats: the stretches that each get one image.
 *
 * Speech is cut at word boundaries into beats of about 1.5–3 seconds, preferring a pause or the
 * end of a sentence, so each image changes as a phrase starts. The beats cover the whole audio
 * with no gaps (the first starts at 0, the last ends with the audio), because every frame of
 * the draft needs a picture. Audio without words (music) falls back to an even grid.
 *
 * Once the agent has marked each beat's story moment, `planByMoment` re-cuts each stretch of
 * one moment with that moment's length range (src/domain/direction.ts).
 */

import { BEAT_LENGTH, DEFAULT_BEAT_LENGTH, type Moment } from "./direction.ts";
import type { Word } from "./post.ts";

/** Part of every beat plan's input hash: a change here makes existing plans stale. */
export const PLANNER_VERSION = 2;

export interface BeatSpan {
	readonly index: number;
	readonly start: number;
	readonly end: number;
	readonly text: string;
	readonly moment?: Moment;
}

export interface BeatRules {
	readonly minSec: number;
	readonly maxSec: number;
	/** A silence at least this long between words is a good place to cut. */
	readonly pauseSec: number;
}

export const DEFAULT_RULES: BeatRules = { minSec: 1.5, maxSec: 3, pauseSec: 0.25 };

const SENTENCE_END = /[.!?;:…]$/;

const round = (seconds: number): number => Math.round(seconds * 1000) / 1000;
const EPSILON = 0.005;

/** An even grid of `maxSec`-or-shorter beats, for stretches with no words. */
const grid = (start: number, end: number, rules: BeatRules): ReadonlyArray<BeatSpan> => {
	const count = Math.max(1, Math.ceil((end - start) / ((rules.minSec + rules.maxSec) / 2)));
	const step = (end - start) / count;
	return Array.from({ length: count }, (_, index) => ({
		index,
		start: round(start + index * step),
		end: round(index === count - 1 ? end : start + (index + 1) * step),
		text: "",
	}));
};

/** How many equal beats fill `length` seconds: near the middle of the range, inside it if possible. */
const beatCount = (length: number, rules: BeatRules): number => {
	const fewest = Math.max(1, Math.ceil(length / rules.maxSec));
	const most = Math.max(fewest, Math.floor(length / rules.minSec));
	const middle = Math.round(length / ((rules.minSec + rules.maxSec) / 2));
	return Math.min(most, Math.max(fewest, middle));
};

/**
 * Whether a silence gets beats of its own instead of holding the image next to it: when it is
 * longer than a beat or stretches that beat well past the maximum, and `spare` (the part a
 * phrase's beat doesn't need) is long enough to be a beat.
 */
const ownBeats = (silence: number, spare: number, beatLength: number, rules: BeatRules): boolean =>
	spare >= rules.minSec && (silence > rules.maxSec || beatLength > rules.maxSec * 1.5);

export const planBeats = (
	words: ReadonlyArray<Word>,
	durationSec: number,
	rules: BeatRules = DEFAULT_RULES,
): ReadonlyArray<BeatSpan> =>
	planSpan(words, 0, Math.max(durationSec, words.at(-1)?.end ?? 0), rules);

/** Beats covering exactly [start, end], cut at the boundaries of the words inside it. */
const planSpan = (
	words: ReadonlyArray<Word>,
	start: number,
	end: number,
	rules: BeatRules,
): ReadonlyArray<BeatSpan> => {
	if (words.length === 0) return grid(start, end, rules);

	// Group consecutive words into phrases. A pause long enough to be a beat ends a phrase however
	// short it is, so the image changes when speech starts again.
	const groups: Array<Array<Word>> = [];
	let current: Array<Word> = [];
	words.forEach((word, i) => {
		current.push(word);
		const first = current[0] as Word;
		const length = word.end - first.start;
		const next = words[i + 1];
		const pause = next === undefined ? Number.POSITIVE_INFINITY : next.start - word.end;
		const goodCut = pause >= rules.pauseSec || SENTENCE_END.test(word.text);
		if (
			next === undefined ||
			length >= rules.maxSec ||
			pause >= rules.minSec ||
			(length >= rules.minSec && goodCut)
		) {
			groups.push(current);
			current = [];
		}
	});

	// A last phrase much shorter than a beat joins the one before it, unless a pause long enough
	// to be a beat comes between them.
	const last = groups.at(-1);
	const beforeLast = groups.at(-2);
	if (last !== undefined && beforeLast !== undefined) {
		const lastLength = (last.at(-1) as Word).end - (last[0] as Word).start;
		const pauseBefore = (last[0] as Word).start - (beforeLast.at(-1) as Word).end;
		if (lastLength < rules.minSec / 2 && pauseBefore < rules.minSec) {
			groups.pop();
			beforeLast.push(...last);
		}
	}

	// Back-to-back spans: each beat runs until the next phrase starts.
	const spans = groups.map((group) => ({
		start: (group[0] as Word).start,
		end: 0,
		spokenEnd: (group.at(-1) as Word).end,
		text: group.map((w) => w.text).join(" "),
	}));
	spans.forEach((span, index) => {
		span.end = spans[index + 1]?.start ?? end;
	});

	const out: Array<BeatSpan> = [];
	const push = (from: number, to: number, text: string) =>
		out.push({ index: out.length, start: round(from), end: round(to), text });
	const pushSilentBeats = (from: number, to: number) => {
		const count = beatCount(to - from, rules);
		const step = (to - from) / count;
		for (let part = 0; part < count; part++)
			push(from + part * step, part === count - 1 ? to : from + (part + 1) * step, "");
	};

	// Silence before the first word: beats of its own, or the first phrase's beat starts early.
	const first = spans[0] as (typeof spans)[number];
	const lead = first.start - start;
	if (ownBeats(lead, lead, first.end - start, rules)) pushSilentBeats(start, first.start);
	else first.start = start;

	// Silence after a phrase: the phrase keeps at least a minimum-length beat, so a short one
	// isn't a flash, and the rest of a long silence gets beats of its own.
	for (const span of spans) {
		const heldUntil = Math.min(span.end, Math.max(span.spokenEnd, span.start + rules.minSec));
		if (!ownBeats(span.end - span.spokenEnd, span.end - heldUntil, span.end - span.start, rules)) {
			push(span.start, span.end, span.text);
			continue;
		}
		push(span.start, heldUntil, span.text);
		pushSilentBeats(heldUntil, span.end);
	}
	return out;
};

export interface Section {
	readonly start: number;
	readonly end: number;
	readonly moment?: Moment;
}

/** The runs of consecutive beats that share a moment, as time ranges. */
export const sectionsOf = (
	beats: ReadonlyArray<{ readonly start: number; readonly end: number; readonly moment?: Moment }>,
): ReadonlyArray<Section> => {
	const sections: Array<{ start: number; end: number; moment?: Moment }> = [];
	for (const beat of beats) {
		const last = sections.at(-1);
		if (last !== undefined && last.moment === beat.moment) last.end = beat.end;
		else
			sections.push({
				start: beat.start,
				end: beat.end,
				...(beat.moment ? { moment: beat.moment } : {}),
			});
	}
	return sections;
};

/**
 * Re-cuts each section with its moment's length range. A word belongs to the section where it
 * starts. The result covers the same span as the sections, and each beat keeps its moment.
 */
export const planByMoment = (
	words: ReadonlyArray<Word>,
	sections: ReadonlyArray<Section>,
	pauseSec: number = DEFAULT_RULES.pauseSec,
): ReadonlyArray<BeatSpan> => {
	const out: Array<BeatSpan> = [];
	sections.forEach((section, i) => {
		const last = i === sections.length - 1;
		// Section bounds are rounded to milliseconds; word times aren't.
		const inside = words.filter(
			(w) => w.start >= section.start - EPSILON && (last || w.start < section.end - EPSILON),
		);
		const range = section.moment === undefined ? DEFAULT_BEAT_LENGTH : BEAT_LENGTH[section.moment];
		for (const span of planSpan(inside, section.start, section.end, { ...range, pauseSec })) {
			out.push({
				...span,
				index: out.length,
				...(section.moment ? { moment: section.moment } : {}),
			});
		}
	});
	return out;
};
