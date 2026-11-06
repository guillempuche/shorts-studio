import {
	DEFAULT_MOTION,
	FRAME,
	MAX_ZOOM,
	type Motion,
	MotionType,
	PUNCH,
} from "@shorts-studio/domain/direction";
import { describe, expect, it } from "vitest";
import { motionExpressions, renderArgs } from "./ffmpeg-render.ts";

/** Evaluates a zoompan expression for one frame, the way ffmpeg would. */
const evaluate = (expression: string, vars: Record<string, number>): number => {
	const js = expression
		.replace(/min\(/g, "Math.min(")
		.replace(/\b(on|iw|ih|zoom)\b/g, (v) => `vars.${v}`);
	return new Function("vars", `return ${js};`)(vars) as number;
};

const twoBeats = [
	{ start: 0, end: 2, image: "images/beat-00.jpg", motion: DEFAULT_MOTION },
	{ start: 2, end: 4, image: "images/beat-01.jpg", motion: DEFAULT_MOTION },
];

const filterOf = (args: ReadonlyArray<string>): string =>
	args[args.indexOf("-filter_complex") + 1] ?? "";

describe("renderArgs", () => {
	it("should burn the captions and keep the post's audio", () => {
		// GIVEN two beats, the post's audio and captions
		// WHEN the ffmpeg arguments are built
		const args = renderArgs(twoBeats, "audio/audio.m4a", "captions.ass", "out.mp4");

		// THEN the beats are joined and the captions filter runs last
		const filter = filterOf(args);
		expect(filter).toContain("concat=n=2:v=1:a=0[vcat]");
		expect(filter.endsWith("[vcat]subtitles=filename=captions.ass[vout]")).toBe(true);
		// AND the audio, the input after the images, is mapped into the output
		expect(args).toContain("2:a");
		expect(args.at(-1)).toBe("out.mp4");
	});

	it("should make a silent video without captions when neither is given", () => {
		// GIVEN two beats and no audio or captions, as for a CapCut clip
		// WHEN the ffmpeg arguments are built
		const args = renderArgs(twoBeats, undefined, undefined, "clip.mp4");

		// THEN nothing is burned in and the output has no audio track
		expect(filterOf(args).endsWith("[vcat]null[vout]")).toBe(true);
		expect(args).toContain("-an");
		expect(args).not.toContain("-shortest");
	});

	it("should cut each beat to exactly its own frames", () => {
		// GIVEN a beat from 0 to 1.234 s
		// WHEN the ffmpeg arguments are built
		const beat = { start: 0, end: 1.234, image: "a.jpg", motion: DEFAULT_MOTION };
		const args = renderArgs([beat], undefined, undefined, "o.mp4");

		// THEN the beat's video ends after round(1.234 × 30) = 37 frames
		expect(filterOf(args)).toContain("trim=end_frame=37");
	});
});

describe("motionExpressions", () => {
	it("should never move the view past the image's edges", () => {
		// GIVEN every motion type over a 3-second beat on an upscaled image
		const frames = 3 * FRAME.fps;
		const size = { iw: 2496, ih: 4448 };
		for (const type of MotionType.literals) {
			const motion: Motion = { type, ratePctPerSec: 4 };
			const { z, x, y } = motionExpressions(motion, frames);
			for (const on of [0, Math.floor(frames / 2), frames - 1]) {
				// WHEN the view is worked out for the first, middle and last frame
				const zoom = evaluate(z, { on });
				const left = evaluate(x, { on, zoom, ...size });
				const top = evaluate(y, { on, zoom, ...size });

				// THEN the zoom stays between 1 and the maximum
				expect(zoom, type).toBeGreaterThanOrEqual(1);
				expect(zoom, type).toBeLessThanOrEqual(1 + MAX_ZOOM + 1e-9);
				// AND the view stays inside the image
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
		// THEN it has already arrived, and stays
		expect(evaluate(z, { on: 15 })).toBeCloseTo(1 + PUNCH.zoom);
		expect(evaluate(z, { on: 89 })).toBeCloseTo(1 + PUNCH.zoom);
	});
});
