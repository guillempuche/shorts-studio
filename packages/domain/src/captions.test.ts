import { describe, expect, it } from "vitest";
import { groupCaptions, toAss, toSrt } from "./captions.ts";
import { CAPTION_LAYOUT, CAPTION_LIMITS } from "./direction.ts";
import type { Word } from "./post.ts";

/** A steady speaker: words of 0.3 s with 0.05 s between them. */
const steadyWords = (count: number): Array<Word> =>
	Array.from({ length: count }, (_, i) => ({
		text: `word${i}`,
		start: i * 0.35,
		end: i * 0.35 + 0.3,
	}));

describe("groupCaptions", () => {
	it("should show at most four words at a time", () => {
		// GIVEN twenty steady words
		// WHEN they are grouped into captions
		const groups = groupCaptions(steadyWords(20));

		// THEN no caption holds more than four words
		for (const group of groups) expect(group.text.split(" ").length).toBeLessThanOrEqual(4);
	});

	it("should start a new caption rather than pass two lines of text", () => {
		// GIVEN three quick 15-letter words, 47 characters together
		const long = "abcdefghijklmno";
		const words: Array<Word> = [0, 1, 2].map((i) => ({
			text: long,
			start: i * 0.2,
			end: i * 0.2 + 0.15,
		}));

		// WHEN they are grouped into captions
		const groups = groupCaptions(words);

		// THEN no caption is longer than the character limit
		expect(groups.length).toBeGreaterThan(1);
		for (const group of groups)
			expect(group.text.length).toBeLessThanOrEqual(CAPTION_LIMITS.maxChars);
	});

	it("should show each caption while its words are spoken, without bridging a pause", () => {
		// GIVEN four words, a pause, then one more word at 5 s
		const words = [...steadyWords(4), { text: "later", start: 5, end: 5.5 }];

		// WHEN they are grouped into captions
		const groups = groupCaptions(words);

		// THEN the first caption starts with its first word and ends before the pause is over
		expect(groups[0]?.start).toBe(words[0]?.start);
		expect(groups[0]?.end).toBeLessThan(5);
		// AND the last caption starts with the word after the pause
		expect(groups.at(-1)?.start).toBe(5);
	});

	it("should never leave one word alone mid-sentence", () => {
		// GIVEN seven words where the fifth would start a caption of its own
		const words: Array<Word> = [
			{ text: "we", start: 0, end: 0.2 },
			{ text: "keep", start: 0.25, end: 0.45 },
			{ text: "going", start: 0.5, end: 0.7 },
			{ text: "back", start: 0.75, end: 0.95 },
			{ text: "again,", start: 1.0, end: 1.3 },
			{ text: "and", start: 2.0, end: 2.2 },
			{ text: "again.", start: 2.25, end: 2.6 },
		];

		// WHEN they are grouped into captions
		const groups = groupCaptions(words);

		// THEN no caption but the last holds a single word
		for (const group of groups.slice(0, -1)) expect(group.words.length).toBeGreaterThan(1);
	});

	it("should not let a lone word make a caption of more than four words", () => {
		// GIVEN four quick words, a fifth that ends a clause, then two more
		const words: Array<Word> = [
			...["a", "b", "c", "d"].map((text, i) => ({ text, start: i * 0.2, end: i * 0.2 + 0.15 })),
			{ text: "e,", start: 0.8, end: 0.95 },
			{ text: "f", start: 1.0, end: 1.15 },
			{ text: "g", start: 1.2, end: 1.35 },
		];

		// WHEN they are grouped into captions
		const groups = groupCaptions(words);

		// THEN the clause's last word shares a caption with the word before it, within four words
		expect(groups.map((g) => g.text)).toEqual(["a b c", "d e,", "f g"]);
	});

	it("should not join a lone word to a caption across a pause", () => {
		// GIVEN a sentence ending at 0.9 s, 5 seconds of silence, then three words from 6 s
		const words: Array<Word> = [
			{ text: "Hello", start: 0, end: 0.4 },
			{ text: "there.", start: 0.45, end: 0.9 },
			{ text: "So,", start: 6, end: 6.3 },
			{ text: "what", start: 6.5, end: 6.7 },
			{ text: "now", start: 6.75, end: 7 },
		];

		// WHEN they are grouped into captions
		const groups = groupCaptions(words);

		// THEN the word after the silence joins the words after it
		expect(groups.map((g) => g.text)).toEqual(["Hello there.", "So, what now"]);
		// AND no caption stays on screen through the silence
		expect(groups[0]?.end).toBeLessThan(6);
		expect(groups[1]?.start).toBe(6);
	});

	it("should keep a caption up long enough to read it", () => {
		// GIVEN a long caption spoken fast, then a pause
		const words: Array<Word> = [
			{ text: "absolutely", start: 0, end: 0.3 },
			{ text: "uncomfortable", start: 0.32, end: 0.6 },
			{ text: "truths.", start: 0.62, end: 0.9 },
			{ text: "Later", start: 4, end: 4.3 },
			{ text: "on.", start: 4.35, end: 4.6 },
		];

		// WHEN they are grouped into captions
		const [first] = groupCaptions(words);

		// THEN the first stays up for its characters at the reading speed cap
		expect((first?.end ?? 0) - (first?.start ?? 0)).toBeGreaterThanOrEqual(
			(first?.text.length ?? 0) / CAPTION_LIMITS.maxCharsPerSec - 1e-9,
		);
	});
});

describe("toAss and toSrt", () => {
	const caption = {
		start: 1.25,
		end: 2.5,
		text: "hello {there}",
		words: [
			{ text: "hello", start: 1.25, end: 1.8 },
			{ text: "{there}", start: 1.9, end: 2.4 },
		],
	};

	it("should write ASS and SRT times that match the caption groups", () => {
		// GIVEN one caption from 1.25 s to 2.5 s with braces in its text
		// WHEN both files are written
		const ass = toAss([caption]);
		const srt = toSrt([caption]);

		// THEN ASS carries the times, without the braces that start override tags there
		expect(ass).toContain("Dialogue: 0,0:00:01.25,0:00:02.50,Caption,,0,0,0,,hello there");
		// AND SRT carries the same times with the text unchanged
		expect(srt).toContain("1\n00:00:01,250 --> 00:00:02,500\nhello {there}");
	});

	it("should place captions at the layout's bottom margin and show the hook title from the start", () => {
		// GIVEN one caption and a hook title
		const groups = groupCaptions([{ text: "Hello there.", start: 0, end: 1 }]);

		// WHEN the ASS file is written
		const ass = toAss(groups, undefined, "Forgive yourself, absurdly");

		// THEN the caption style sits at the layout's bottom margin
		const style = ass.split("\n").find((line) => line.startsWith("Style: Caption,"));
		expect(style?.endsWith(`,${CAPTION_LAYOUT.marginBottom},1`)).toBe(true);
		// AND the hook title shows from 0 s for two to three seconds
		expect(ass).toMatch(
			/Dialogue: 1,0:00:00\.00,0:00:0[23]\.\d\d,Hook,,0,0,0,,Forgive yourself, absurdly/,
		);
	});

	it("should leave the hook title out when there is none", () => {
		// GIVEN one caption and a blank hook
		const groups = groupCaptions([{ text: "Hello there.", start: 0, end: 1 }]);

		// WHEN the ASS file is written
		const ass = toAss(groups, undefined, "  ");

		// THEN only the caption is shown
		expect(ass).not.toContain(",Hook,");
		expect(ass).toContain(",Caption,");
	});

	it("should colour each word as it's spoken when highlighting is on", () => {
		// GIVEN two words
		const groups = groupCaptions([
			{ text: "Hello", start: 0, end: 0.4 },
			{ text: "there.", start: 0.5, end: 0.9 },
		]);

		// WHEN captions are written with highlighting
		const ass = toAss(groups, { font: "Arial", fontSize: 80, highlight: true });

		// THEN each word carries a karaoke timing until the next word starts
		expect(ass).toMatch(/\{\\k50\}Hello \{\\k\d+\}there\./);
	});
});
