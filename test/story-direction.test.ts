import { describe, expect, it } from "vitest";
import {
	BEAT_LENGTH,
	CAPTION_LAYOUT,
	CAPTION_LIMITS,
	hookDuration,
	type Motion,
	MotionType,
	motionOf,
} from "../src/domain/direction.ts";
import type { Word } from "../src/domain/post.ts";
import { planByMoment, sectionsOf } from "../src/work/beats.ts";
import { groupCaptions, toAss } from "../src/work/captions.ts";
import { FRAME, motionExpressions } from "../src/work/render.ts";

/** Steady speech: `count` words of 0.3 s with 0.05 s gaps from `from`, a sentence end every `every`. */
const speech = (count: number, from = 0, every = 4): Array<Word> =>
	Array.from({ length: count }, (_, i) => ({
		text: (i + 1) % every === 0 ? `w${i}.` : `w${i}`,
		start: from + i * 0.35,
		end: from + i * 0.35 + 0.3,
	}));

/** Evaluates a zoompan expression for one frame, the way ffmpeg would. */
const evaluate = (expression: string, vars: Record<string, number>): number => {
	const js = expression
		.replace(/min\(/g, "Math.min(")
		.replace(/\b(on|iw|ih|zoom)\b/g, (v) => `vars.${v}`);
	return new Function("vars", `return ${js};`)(vars) as number;
};

describe("beat planning by moment", () => {
	it("should give each moment's stretch beats within that moment's length range", () => {
		// GIVEN 20 s of steady speech marked hook (0–3 s), setup (3–12 s) and vulnerable (12–20 s)
		const words = speech(57);
		const sections = [
			{ start: 0, end: 3, moment: "hook" as const },
			{ start: 3, end: 12, moment: "setup" as const },
			{ start: 12, end: 20, moment: "vulnerable" as const },
		];
		// WHEN it's re-cut by moment
		const beats = planByMoment(words, sections);
		// THEN every beat but each stretch's last stays within its moment's range (word slack 0.4 s)
		for (const section of sections) {
			const own = beats.filter((b) => b.moment === section.moment);
			const range = BEAT_LENGTH[section.moment];
			for (const beat of own.slice(0, -1)) {
				expect(beat.end - beat.start, `${section.moment} ${beat.index}`).toBeGreaterThanOrEqual(
					range.minSec,
				);
				expect(beat.end - beat.start, `${section.moment} ${beat.index}`).toBeLessThanOrEqual(
					range.maxSec + 0.4,
				);
			}
		}
	});

	it("should keep covering the audio without gaps", () => {
		// GIVEN two marked stretches
		const sections = [
			{ start: 0, end: 5, moment: "tension" as const },
			{ start: 5, end: 10, moment: "payoff" as const },
		];
		// WHEN they're re-cut
		const beats = planByMoment(speech(28), sections);
		// THEN the beats run from 0 to 10 with no gap or overlap
		expect(beats[0]?.start).toBe(0);
		expect(beats.at(-1)?.end).toBe(10);
		for (let i = 1; i < beats.length; i++) expect(beats[i]?.start).toBe(beats[i - 1]?.end);
	});

	it("should read stretches from consecutive beats that share a moment", () => {
		// GIVEN beats marked hook, hook, setup
		// WHEN they're turned into sections
		const sections = sectionsOf([
			{ start: 0, end: 1, moment: "hook" },
			{ start: 1, end: 2, moment: "hook" },
			{ start: 2, end: 5, moment: "setup" },
		]);
		// THEN there are two stretches, joined at 2 s
		expect(sections).toEqual([
			{ start: 0, end: 2, moment: "hook" },
			{ start: 2, end: 5, moment: "setup" },
		]);
	});
});

describe("motion", () => {
	it("should hold a vulnerable moment almost still and punch into a twist", () => {
		// GIVEN the motions of two moments
		// WHEN they're chosen
		// THEN vulnerable moves slowly and the twist punches in
		expect(motionOf("vulnerable", undefined)).toEqual({ type: "push-slow", ratePctPerSec: 1 });
		expect(motionOf("twist", undefined).type).toBe("push-punch");
	});

	it("should let a beat's motion replace its moment's", () => {
		// GIVEN a payoff beat told to drift up
		// WHEN its motion is chosen
		// THEN it drifts up
		expect(motionOf("payoff", "drift-up").type).toBe("drift-up");
	});

	it("should never move the view past the image's edges", () => {
		// GIVEN every motion type over a 3-second beat
		const frames = 3 * FRAME.fps;
		const size = { iw: 2496, ih: 4448 };
		for (const type of MotionType.literals) {
			const motion: Motion = { type, ratePctPerSec: 4 };
			const { z, x, y } = motionExpressions(motion, frames);
			for (const on of [0, Math.floor(frames / 2), frames - 1]) {
				// WHEN the view is computed for a frame
				const zoom = evaluate(z, { on });
				const left = evaluate(x, { on, zoom, ...size });
				const top = evaluate(y, { on, zoom, ...size });
				// THEN zoom stays in 1–1.15 and the view stays inside the image
				expect(zoom, type).toBeGreaterThanOrEqual(1);
				expect(zoom, type).toBeLessThanOrEqual(1.15 + 1e-9);
				expect(left, type).toBeGreaterThanOrEqual(-1e-6);
				expect(left + size.iw / zoom, type).toBeLessThanOrEqual(size.iw + 1e-6);
				expect(top, type).toBeGreaterThanOrEqual(-1e-6);
				expect(top + size.ih / zoom, type).toBeLessThanOrEqual(size.ih + 1e-6);
			}
		}
	});

	it("should reach a punch-in's zoom within half a second, then hold it", () => {
		// GIVEN a punch-in over a 3-second beat
		const { z } = motionExpressions({ type: "push-punch", ratePctPerSec: 0 }, 90);
		// WHEN its zoom is read at 0.5 s and at the end
		// THEN it has already arrived and stays
		expect(evaluate(z, { on: 15 })).toBeCloseTo(1.12);
		expect(evaluate(z, { on: 89 })).toBeCloseTo(1.12);
	});
});

describe("captions within reading limits", () => {
	it("should never leave one word alone mid-sentence", () => {
		// GIVEN five words where the fifth would start a caption of its own
		const words: Array<Word> = [
			{ text: "we", start: 0, end: 0.2 },
			{ text: "keep", start: 0.25, end: 0.45 },
			{ text: "going", start: 0.5, end: 0.7 },
			{ text: "back", start: 0.75, end: 0.95 },
			{ text: "again,", start: 1.0, end: 1.3 },
			{ text: "and", start: 2.0, end: 2.2 },
			{ text: "again.", start: 2.25, end: 2.6 },
		];
		// WHEN they're grouped
		const groups = groupCaptions(words);
		// THEN no caption but the last holds a single word
		for (const group of groups.slice(0, -1)) expect(group.words.length).toBeGreaterThan(1);
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
		// WHEN they're grouped
		const [first] = groupCaptions(words);
		// THEN it stays up for its characters at the reading cap
		expect((first?.end ?? 0) - (first?.start ?? 0)).toBeGreaterThanOrEqual(
			(first?.text.length ?? 0) / CAPTION_LIMITS.maxCharsPerSec - 1e-9,
		);
	});

	it("should place captions above every platform's bottom zone and add the hook title on top", () => {
		// GIVEN one caption and a hook title
		const ass = toAss(
			groupCaptions([{ text: "Hello there.", start: 0, end: 1 }]),
			undefined,
			"Forgive yourself, absurdly",
		);
		// WHEN the ASS file is written
		// THEN the caption's bottom margin clears the 672 px zone, and the hook shows from 0 s
		expect(CAPTION_LAYOUT.marginBottom).toBeGreaterThan(672);
		expect(ass).toContain(`,${CAPTION_LAYOUT.marginBottom},1`);
		expect(ass).toContain("Hook,,0,0,0,,Forgive yourself, absurdly");
		expect(hookDuration("Forgive yourself, absurdly")).toBeGreaterThanOrEqual(2);
	});

	it("should colour each word as it's spoken when highlighting is on", () => {
		// GIVEN two words
		const groups = groupCaptions([
			{ text: "Hello", start: 0, end: 0.4 },
			{ text: "there.", start: 0.5, end: 0.9 },
		]);
		// WHEN captions are written with highlighting
		const ass = toAss(groups, { font: "Arial", fontSize: 80, highlight: true });
		// THEN each word carries a karaoke timing
		expect(ass).toMatch(/\{\\k50\}Hello \{\\k\d+\}there\./);
	});
});
