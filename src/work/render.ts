/**
 * The ffmpeg command for a draft: one still per beat with a slow zoom, cut exactly on the beat
 * boundaries, captions burned in, and the post's audio underneath. 1080×1920 at 30 fps.
 *
 * Frame counts come from the beats' absolute times (round(end·fps) − round(start·fps)), so
 * rounding never accumulates and the pictures stay in sync with the audio over a long post.
 */

/** Part of every draft's input hash: a change to how drafts look makes old drafts stale. */
export const RENDERER_VERSION = 1;

export const FRAME = { width: 1080, height: 1920, fps: 30 } as const;
/** Each image is upscaled before the zoom: zoompan on a full-size frame visibly jitters. */
const UPSCALE = { width: 2496, height: 4448 } as const;
/** How far the slow zoom travels over a beat. */
const ZOOM = 0.08;

export interface RenderBeat {
	readonly start: number;
	readonly end: number;
	/** Image path relative to the post folder (ffmpeg runs there). */
	readonly image: string;
}

export const framesOf = (beat: { readonly start: number; readonly end: number }): number =>
	Math.max(1, Math.round(beat.end * FRAME.fps) - Math.round(beat.start * FRAME.fps));

export const renderArgs = (
	beats: ReadonlyArray<RenderBeat>,
	audio: string,
	captionsAss: string,
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
		const step = (ZOOM / frames).toFixed(6);
		// Alternate zooming in and out so consecutive beats don't feel identical.
		const z = i % 2 === 0 ? `1+${step}*on` : `${1 + ZOOM}-${step}*on`;
		return (
			`[${i}:v]scale=${UPSCALE.width}:${UPSCALE.height},` +
			`zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${FRAME.width}x${FRAME.height}:fps=${FRAME.fps},` +
			`trim=end_frame=${frames},setpts=PTS-STARTPTS,setsar=1[v${i}]`
		);
	});
	const concat = `${beats.map((_, i) => `[v${i}]`).join("")}concat=n=${beats.length}:v=1:a=0[vcat]`;
	const captions = `[vcat]subtitles=filename=${captionsAss}[vout]`;
	return [
		"-hide_banner",
		"-loglevel",
		"error",
		"-y",
		...inputs,
		"-i",
		audio,
		"-filter_complex",
		[...zoomed, concat, captions].join(";"),
		"-map",
		"[vout]",
		"-map",
		`${beats.length}:a`,
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
		"-c:a",
		"aac",
		"-b:a",
		"192k",
		"-shortest",
		"-movflags",
		"+faststart",
		output,
	];
};
