/**
 * Splitting audio into beats: the stretches that each get one image.
 *
 * Speech is cut at word boundaries into beats of about 1.5–3 seconds, preferring a pause or the
 * end of a sentence, so each image changes as a phrase starts. The beats cover the whole audio
 * with no gaps (the first starts at 0, the last ends with the audio), because every frame of
 * the draft needs a picture. Audio without words (music) falls back to an even grid.
 */

import type { Word } from "../domain/post.ts";

/** Part of every beat plan's input hash: a change here makes existing plans stale. */
export const PLANNER_VERSION = 1;

export interface BeatSpan {
	readonly index: number;
	readonly start: number;
	readonly end: number;
	readonly text: string;
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

/** An even grid of `maxSec`-or-shorter beats, for audio with no words. */
const grid = (durationSec: number, rules: BeatRules): ReadonlyArray<BeatSpan> => {
	const count = Math.max(1, Math.ceil(durationSec / ((rules.minSec + rules.maxSec) / 2)));
	const step = durationSec / count;
	return Array.from({ length: count }, (_, index) => ({
		index,
		start: round(index * step),
		end: round(index === count - 1 ? durationSec : (index + 1) * step),
		text: "",
	}));
};

export const planBeats = (
	words: ReadonlyArray<Word>,
	durationSec: number,
	rules: BeatRules = DEFAULT_RULES,
): ReadonlyArray<BeatSpan> => {
	if (words.length === 0) return grid(durationSec, rules);

	// Group consecutive words into phrases.
	const groups: Array<Array<Word>> = [];
	let current: Array<Word> = [];
	words.forEach((word, i) => {
		current.push(word);
		const first = current[0] as Word;
		const length = word.end - first.start;
		const next = words[i + 1];
		const pause = next === undefined ? Number.POSITIVE_INFINITY : next.start - word.end;
		const goodCut = pause >= rules.pauseSec || SENTENCE_END.test(word.text);
		if (next === undefined || length >= rules.maxSec || (length >= rules.minSec && goodCut)) {
			groups.push(current);
			current = [];
		}
	});

	// A last phrase much shorter than a beat joins the one before it.
	const last = groups.at(-1);
	if (groups.length > 1 && last !== undefined) {
		const lastLength = (last.at(-1) as Word).end - (last[0] as Word).start;
		if (lastLength < rules.minSec / 2) {
			groups.pop();
			groups.at(-1)?.push(...last);
		}
	}

	// Contiguous spans: each beat runs until the next phrase starts.
	const spans = groups.map((group, index) => ({
		start: index === 0 ? 0 : (group[0] as Word).start,
		end: 0,
		text: group.map((w) => w.text).join(" "),
	}));
	spans.forEach((span, index) => {
		span.end = spans[index + 1]?.start ?? Math.max(durationSec, (words.at(-1) as Word).end);
	});

	// A long silence makes a long span; split it so no image holds much past maxSec.
	const out: Array<BeatSpan> = [];
	for (const span of spans) {
		const parts = Math.max(1, Math.round((span.end - span.start) / rules.maxSec));
		const step = (span.end - span.start) / parts;
		for (let part = 0; part < parts; part++) {
			out.push({
				index: out.length,
				start: round(span.start + part * step),
				end: round(part === parts - 1 ? span.end : span.start + (part + 1) * step),
				text: part === 0 ? span.text : "",
			});
		}
	}
	return out;
};
