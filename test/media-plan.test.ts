import { describe, expect, it } from "vitest";
import type { Word } from "../src/domain/post.ts";
import { planBeats } from "../src/work/beats.ts";
import { groupCaptions, toAss, toSrt } from "../src/work/captions.ts";
import { FRAME, framesOf, renderArgs } from "../src/work/render.ts";

/** Words of `per` seconds each with `gap` between them, e.g. a steady speaker. */
const steadyWords = (count: number, per = 0.3, gap = 0.05, punctuateEvery = 0): Array<Word> =>
	Array.from({ length: count }, (_, i) => ({
		text: punctuateEvery > 0 && (i + 1) % punctuateEvery === 0 ? `word${i}.` : `word${i}`,
		start: i * (per + gap),
		end: i * (per + gap) + per,
	}));

describe("planBeats", () => {
	it("should cover the whole audio with contiguous beats", () => {
		// GIVEN 40 steadily spoken words in 15 seconds of audio
		const words = steadyWords(40);
		// WHEN the beats are planned
		const beats = planBeats(words, 15);
		// THEN they start at 0, end with the audio, and leave no gap or overlap
		expect(beats[0]?.start).toBe(0);
		expect(beats.at(-1)?.end).toBe(15);
		for (let i = 1; i < beats.length; i++) expect(beats[i]?.start).toBe(beats[i - 1]?.end);
	});

	it("should keep speech beats between about 1.5 and 3 seconds", () => {
		// GIVEN continuous speech with a sentence end every 6 words
		const words = steadyWords(60, 0.3, 0.05, 6);
		// WHEN the beats are planned
		const beats = planBeats(words, words.at(-1)?.end ?? 0);
		// THEN every beat but the last is within the target range (one word of slack)
		for (const beat of beats.slice(0, -1)) {
			expect(beat.end - beat.start).toBeGreaterThanOrEqual(1.5);
			expect(beat.end - beat.start).toBeLessThanOrEqual(3.4);
		}
	});

	it("should cut at a sentence end once the beat is long enough", () => {
		// GIVEN a sentence ending after about 1.7 s, followed by more speech
		const words = steadyWords(20, 0.3, 0.05, 5);
		// WHEN the beats are planned
		const beats = planBeats(words, 8);
		// THEN the first beat's text ends with the sentence
		expect(beats[0]?.text.endsWith(".")).toBe(true);
	});

	it("should split a long silence so no image holds far beyond the maximum", () => {
		// GIVEN two short phrases separated by 9 seconds of silence
		const words: Array<Word> = [
			...steadyWords(6),
			{ text: "again", start: 11, end: 11.4 },
			{ text: "now.", start: 11.45, end: 12 },
		];
		// WHEN the beats are planned
		const beats = planBeats(words, 12);
		// THEN no beat is longer than about 1.5× the maximum
		for (const beat of beats) expect(beat.end - beat.start).toBeLessThanOrEqual(4.5);
	});

	it("should fall back to an even grid when there are no words (music)", () => {
		// GIVEN 10 seconds of audio without words
		// WHEN the beats are planned
		const beats = planBeats([], 10);
		// THEN equal beats cover the audio and carry no text
		expect(beats.length).toBeGreaterThan(2);
		expect(beats.at(-1)?.end).toBe(10);
		expect(beats.every((b) => b.text === "")).toBe(true);
	});
});

describe("captions", () => {
	it("should show at most four words at a time", () => {
		// GIVEN twenty steady words
		// WHEN they are grouped into captions
		const groups = groupCaptions(steadyWords(20));
		// THEN no caption holds more than four words
		for (const group of groups) expect(group.text.split(" ").length).toBeLessThanOrEqual(4);
	});

	it("should show each caption while its words are spoken", () => {
		// GIVEN words with a pause in the middle
		const words = [...steadyWords(4), { text: "later", start: 5, end: 5.5 }];
		// WHEN they are grouped into captions
		const groups = groupCaptions(words);
		// THEN each caption starts with its first word, and the pause is not bridged
		expect(groups[0]?.start).toBe(words[0]?.start);
		expect(groups.at(-1)?.start).toBe(5);
		expect(groups[0]?.end).toBeLessThan(5);
	});

	it("should write ASS and SRT times that match the caption groups", () => {
		// GIVEN one caption from 1.25 s to 2.5 s
		const groups = [{ start: 1.25, end: 2.5, text: "hello {there}" }];
		// WHEN both files are written
		const ass = toAss(groups);
		const srt = toSrt(groups);
		// THEN the times match, and ASS override braces are removed from the text
		expect(ass).toContain("Dialogue: 0,0:00:01.25,0:00:02.50,Caption,,0,0,0,,hello there");
		expect(srt).toContain("00:00:01,250 --> 00:00:02,500\nhello {there}");
	});
});

describe("render", () => {
	it("should give the beats exactly the frames the audio needs, with no drift", () => {
		// GIVEN beats whose boundaries don't fall on frame boundaries
		const beats = [
			{ start: 0, end: 1.234 },
			{ start: 1.234, end: 2.951 },
			{ start: 2.951, end: 60.4 },
		];
		// WHEN their frames are counted
		const total = beats.reduce((sum, beat) => sum + framesOf(beat), 0);
		// THEN they add up to the audio's length in frames
		expect(total).toBe(Math.round(60.4 * FRAME.fps));
	});

	it("should burn the captions and keep the post's audio", () => {
		// GIVEN two beats
		const args = renderArgs(
			[
				{ start: 0, end: 2, image: "images/beat-00.jpg" },
				{ start: 2, end: 4, image: "images/beat-01.jpg" },
			],
			"audio/audio.m4a",
			"captions.ass",
			"out.mp4",
		);
		// WHEN the ffmpeg arguments are built
		const filter = args[args.indexOf("-filter_complex") + 1] ?? "";
		// THEN the captions filter runs last and the audio input is mapped
		expect(filter).toContain("concat=n=2:v=1:a=0[vcat]");
		expect(filter.endsWith("[vcat]subtitles=filename=captions.ass[vout]")).toBe(true);
		expect(args).toContain("2:a");
		expect(args.at(-1)).toBe("out.mp4");
	});
});
