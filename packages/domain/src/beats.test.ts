import { describe, expect, it } from "vitest";
import { planBeats, planByMoment, sectionsOf } from "./beats.ts";
import { BEAT_LENGTH } from "./direction.ts";
import type { Word } from "./post.ts";

/** A steady speaker: words of 0.3 s with 0.05 s between them, a sentence end every `sentenceEvery`. */
const steadyWords = (count: number, sentenceEvery = 0): Array<Word> =>
	Array.from({ length: count }, (_, i) => ({
		text: sentenceEvery > 0 && (i + 1) % sentenceEvery === 0 ? `word${i}.` : `word${i}`,
		start: i * 0.35,
		end: i * 0.35 + 0.3,
	}));

const expectBackToBack = (beats: ReadonlyArray<{ start: number; end: number }>) => {
	for (let i = 1; i < beats.length; i++) expect(beats[i]?.start).toBe(beats[i - 1]?.end);
};

describe("planBeats", () => {
	it("should cover the whole audio with beats back to back", () => {
		// GIVEN 40 steadily spoken words in 15 seconds of audio
		const words = steadyWords(40);

		// WHEN the beats are planned
		const beats = planBeats(words, 15);

		// THEN they start at 0 and end with the audio
		expect(beats[0]?.start).toBe(0);
		expect(beats.at(-1)?.end).toBe(15);
		// AND they leave no gap or overlap
		expectBackToBack(beats);
	});

	it("should keep speech beats between about 1.5 and 3 seconds", () => {
		// GIVEN continuous speech with a sentence end every 6 words
		const words = steadyWords(60, 6);

		// WHEN the beats are planned
		const beats = planBeats(words, words.at(-1)?.end ?? 0);

		// THEN every beat but the last is within the range, give or take one word
		for (const beat of beats.slice(0, -1)) {
			expect(beat.end - beat.start).toBeGreaterThanOrEqual(1.5);
			expect(beat.end - beat.start).toBeLessThanOrEqual(3.4);
		}
	});

	it("should cut at a sentence end once the beat is long enough", () => {
		// GIVEN a sentence ending after about 1.7 s, followed by more speech
		const words = steadyWords(20, 5);

		// WHEN the beats are planned
		const beats = planBeats(words, 8);

		// THEN the first beat ends with the sentence
		expect(beats[0]?.text.endsWith(".")).toBe(true);
	});

	it("should join a last phrase much shorter than a beat to the one before", () => {
		// GIVEN a 1.7 s sentence, a pause, then one short word
		const words: Array<Word> = [...steadyWords(5, 5), { text: "yes.", start: 2.5, end: 2.8 }];

		// WHEN the beats are planned
		const beats = planBeats(words, 3);

		// THEN the short word shares the sentence's beat
		expect(beats).toHaveLength(1);
		expect(beats[0]?.text).toBe("word0 word1 word2 word3 word4. yes.");
	});

	it("should split a long silence so no image stays up much longer than the maximum", () => {
		// GIVEN two short phrases separated by 9 seconds of silence
		const words: Array<Word> = [
			...steadyWords(6),
			{ text: "again", start: 11, end: 11.4 },
			{ text: "now.", start: 11.45, end: 12 },
		];

		// WHEN the beats are planned
		const beats = planBeats(words, 12);

		// THEN no beat is longer than 1.5 times the maximum
		for (const beat of beats) expect(beat.end - beat.start).toBeLessThanOrEqual(4.5);
	});

	it("should fall back to an even grid when there are no words", () => {
		// GIVEN 10 seconds of music
		// WHEN the beats are planned
		const beats = planBeats([], 10);

		// THEN several equal beats cover the audio
		expect(beats.length).toBeGreaterThan(2);
		expect(beats.at(-1)?.end).toBe(10);
		for (const beat of beats) expect(beat.end - beat.start).toBeCloseTo(10 / beats.length);
		// AND they carry no text
		expect(beats.every((b) => b.text === "")).toBe(true);
	});
});

describe("planByMoment", () => {
	it("should give each moment's stretch beats within that moment's length range", () => {
		// GIVEN 20 s of steady speech marked hook (0–3 s), setup (3–12 s) and vulnerable (12–20 s)
		const words = steadyWords(57, 4);
		const sections = [
			{ start: 0, end: 3, moment: "hook" as const },
			{ start: 3, end: 12, moment: "setup" as const },
			{ start: 12, end: 20, moment: "vulnerable" as const },
		];

		// WHEN the beats are re-cut by moment
		const beats = planByMoment(words, sections);

		// THEN every beat but each stretch's last is within its moment's range, give or take a word
		for (const section of sections) {
			const own = beats.filter((b) => b.moment === section.moment);
			const range = BEAT_LENGTH[section.moment];
			expect(own.length, section.moment).toBeGreaterThan(0);
			for (const beat of own.slice(0, -1)) {
				const length = beat.end - beat.start;
				expect(length, `${section.moment} ${beat.index}`).toBeGreaterThanOrEqual(range.minSec);
				expect(length, `${section.moment} ${beat.index}`).toBeLessThanOrEqual(range.maxSec + 0.4);
			}
		}
	});

	it("should keep covering the audio without gaps", () => {
		// GIVEN two marked stretches over 10 s of speech
		const sections = [
			{ start: 0, end: 5, moment: "tension" as const },
			{ start: 5, end: 10, moment: "payoff" as const },
		];

		// WHEN they are re-cut
		const beats = planByMoment(steadyWords(28, 4), sections);

		// THEN the beats run from 0 to 10 with no gap or overlap
		expect(beats[0]?.start).toBe(0);
		expect(beats.at(-1)?.end).toBe(10);
		expectBackToBack(beats);
	});
});

describe("sectionsOf", () => {
	it("should join back-to-back beats with the same moment into one stretch", () => {
		// GIVEN beats marked hook, hook, setup
		const beats = [
			{ start: 0, end: 1, moment: "hook" as const },
			{ start: 1, end: 2, moment: "hook" as const },
			{ start: 2, end: 5, moment: "setup" as const },
		];

		// WHEN they are turned into sections
		const sections = sectionsOf(beats);

		// THEN there are two stretches, joined at 2 s
		expect(sections).toEqual([
			{ start: 0, end: 2, moment: "hook" },
			{ start: 2, end: 5, moment: "setup" },
		]);
	});
});
