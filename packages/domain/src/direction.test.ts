import { describe, expect, it } from "vitest";
import {
	CAPTION_LAYOUT,
	DEFAULT_MOTION,
	FRAME,
	framesOf,
	hookDuration,
	MOTION_BY_MOMENT,
	motionOf,
} from "./direction.ts";

describe("framesOf", () => {
	it("should give the beats exactly the frames the audio needs, with no drift", () => {
		// GIVEN beats that don't start and end on whole frames
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
});

describe("motionOf", () => {
	it("should hold a vulnerable moment almost still and punch into a twist", () => {
		// GIVEN a vulnerable beat and a twist beat
		// WHEN their motions are chosen
		// THEN the vulnerable one pushes in slowly and the twist punches in
		expect(motionOf("vulnerable", undefined)).toEqual({ type: "push-slow", ratePctPerSec: 1 });
		expect(motionOf("twist", undefined).type).toBe("push-punch");
	});

	it("should let a beat's motion replace its moment's, at the moment's speed", () => {
		// GIVEN a payoff beat told to drift up
		// WHEN its motion is chosen
		const motion = motionOf("payoff", "drift-up");

		// THEN it drifts up at the payoff's speed
		expect(motion).toEqual({
			type: "drift-up",
			ratePctPerSec: MOTION_BY_MOMENT.payoff.ratePctPerSec,
		});
	});

	it("should give a replaced motion the default speed when the moment's own has none", () => {
		// GIVEN a hook beat, whose punch-in has no speed, told to push in slowly
		// WHEN its motion is chosen
		const motion = motionOf("hook", "push-slow");

		// THEN it moves at the default speed instead of standing still
		expect(motion).toEqual({ type: "push-slow", ratePctPerSec: DEFAULT_MOTION.ratePctPerSec });
	});

	it("should use the default motion for a beat with no moment", () => {
		// GIVEN a beat with no moment and no motion of its own
		// WHEN its motion is chosen
		// THEN it gets the default motion
		expect(motionOf(undefined, undefined)).toEqual(DEFAULT_MOTION);
	});
});

describe("CAPTION_LAYOUT", () => {
	it("should keep captions above every platform's bottom zone", () => {
		// GIVEN Reels, whose interface covers the bottom 672 px of a 1920 px frame
		// THEN the caption block's bottom edge sits higher than that
		expect(CAPTION_LAYOUT.marginBottom).toBeGreaterThan(672);
	});
});

describe("hookDuration", () => {
	it("should show a hook title for two to three seconds, longer for more words", () => {
		// GIVEN hook titles of 3, 6 and 12 words
		const short = hookDuration("Forgive yourself, absurdly");
		const medium = hookDuration("one two three four five six");
		const long = hookDuration("one two three four five six seven eight nine ten eleven twelve");

		// THEN the short one stays the minimum, the long one the maximum
		expect(short).toBe(2);
		expect(long).toBe(3);
		// AND one in between gets reading time for its words
		expect(medium).toBeGreaterThan(short);
		expect(medium).toBeLessThan(long);
	});
});
