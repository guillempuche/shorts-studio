/**
 * The ffmpeg command for a draft: one still per beat moving the way its story moment calls for,
 * cut exactly on the beat boundaries, captions burned in, and the post's audio underneath.
 * 1080×1920 at 30 fps.
 *
 * Frame counts come from the beats' absolute times (round(end·fps) − round(start·fps)), so
 * rounding never accumulates and the pictures stay in sync with the audio over a long post.
 */

import { MAX_ZOOM, type Motion, PUNCH, TRAVEL_ZOOM } from "../domain/direction.ts";

/** Part of every draft's input hash: a change to how drafts look makes old drafts stale. */
export const RENDERER_VERSION = 2;

export const FRAME = { width: 1080, height: 1920, fps: 30 } as const;
/** Each image is upscaled before the zoom: zoompan on a full-size frame visibly jitters. */
const UPSCALE = { width: 2496, height: 4448 } as const;

export interface RenderBeat {
	readonly start: number;
	readonly end: number;
	/** Image path relative to the post folder (ffmpeg runs there). */
	readonly image: string;
	readonly motion: Motion;
}

const fixed = (n: number): string => n.toFixed(6);
const CENTRE = { x: "iw/2-(iw/zoom/2)", y: "ih/2-(ih/zoom/2)" } as const;

/**
 * zoompan expressions for one beat. `on` counts output frames from 0; x and y always stay
 * within [0, size − size/zoom], so the view never leaves the image.
 */
export const motionExpressions = (
	motion: Motion,
	frames: number,
): { readonly z: string; readonly x: string; readonly y: string } => {
	const seconds = frames / FRAME.fps;
	const t = `(on/${Math.max(1, frames - 1)})`;
	const travel = Math.min(MAX_ZOOM, (motion.ratePctPerSec / 100) * seconds);
	switch (motion.type) {
		case "hold":
			return { z: "1", ...CENTRE };
		case "push-slow":
			return { z: `1+${fixed(travel)}*${t}`, ...CENTRE };
		case "pull-back":
			return { z: `${fixed(1 + travel)}-${fixed(travel)}*${t}`, ...CENTRE };
		case "push-punch": {
			const punchFrames = Math.max(1, Math.round(PUNCH.seconds * FRAME.fps));
			return { z: `1+${fixed(PUNCH.zoom)}*min(on/${punchFrames},1)`, ...CENTRE };
		}
		case "pan-right":
		case "pan-left": {
			const from = motion.type === "pan-right" ? 0.15 : 0.85;
			const to = motion.type === "pan-right" ? 0.85 : 0.15;
			return {
				z: fixed(1 + TRAVEL_ZOOM.pan),
				x: `(iw-iw/zoom)*(${from}+${fixed(to - from)}*${t})`,
				y: CENTRE.y,
			};
		}
		case "drift-up":
		case "drift-down": {
			const from = motion.type === "drift-up" ? 0.85 : 0.15;
			const to = motion.type === "drift-up" ? 0.15 : 0.85;
			return {
				z: fixed(1 + TRAVEL_ZOOM.drift),
				x: CENTRE.x,
				y: `(ih-ih/zoom)*(${from}+${fixed(to - from)}*${t})`,
			};
		}
	}
};

export const framesOf = (beat: { readonly start: number; readonly end: number }): number =>
	Math.max(1, Math.round(beat.end * FRAME.fps) - Math.round(beat.start * FRAME.fps));

/**
 * The ffmpeg arguments for a sequence of beats. Without `audio` the output is silent; without
 * `captionsAss` nothing is burned in (the CapCut hand-off adds captions from SRT instead).
 */
export const renderArgs = (
	beats: ReadonlyArray<RenderBeat>,
	audio: string | undefined,
	captionsAss: string | undefined,
	output: string,
): ReadonlyArray<string> => {
	const inputs = beats.flatMap((beat) => [
		"-loop",
		"1",
		"-framerate",
		String(FRAME.fps),
		"-t",
		(framesOf(beat) / FRAME.fps + 0.1).toFixed(3),
		"-i",
		beat.image,
	]);
	const zoomed = beats.map((beat, i) => {
		const frames = framesOf(beat);
		const { z, x, y } = motionExpressions(beat.motion, frames);
		return (
			`[${i}:v]scale=${UPSCALE.width}:${UPSCALE.height},` +
			`zoompan=z='${z}':x='${x}':y='${y}':d=1:s=${FRAME.width}x${FRAME.height}:fps=${FRAME.fps},` +
			`trim=end_frame=${frames},setpts=PTS-STARTPTS,setsar=1[v${i}]`
		);
	});
	const concat = `${beats.map((_, i) => `[v${i}]`).join("")}concat=n=${beats.length}:v=1:a=0[vcat]`;
	const captions =
		captionsAss === undefined
			? "[vcat]null[vout]"
			: `[vcat]subtitles=filename=${captionsAss}[vout]`;
	return [
		"-hide_banner",
		"-loglevel",
		"error",
		"-y",
		...inputs,
		...(audio === undefined ? [] : ["-i", audio]),
		"-filter_complex",
		[...zoomed, concat, captions].join(";"),
		"-map",
		"[vout]",
		...(audio === undefined ? ["-an"] : ["-map", `${beats.length}:a`]),
		"-c:v",
		"libx264",
		"-preset",
		"medium",
		"-crf",
		"20",
		"-pix_fmt",
		"yuv420p",
		"-r",
		String(FRAME.fps),
		...(audio === undefined ? [] : ["-c:a", "aac", "-b:a", "192k", "-shortest"]),
		"-movflags",
		"+faststart",
		output,
	];
};
