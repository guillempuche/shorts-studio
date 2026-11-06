/**
 * Story direction: how long beats hold, how images move and how captions read, by story moment.
 *
 * Every number shorts-studio uses for these lives here. The evidence for each, and how strong
 * it is, is in docs/research/. How an agent picks moments is in the story-direction skill. Most
 * numbers are well-supported starting points, not values proven best for 60-second shorts.
 */

import { Schema } from "effect";

export const Moment = Schema.Literals([
	"hook",
	"setup",
	"tension",
	"twist",
	"vulnerable",
	"payoff",
	"cta",
]);
export type Moment = typeof Moment.Type;

export const MotionType = Schema.Literals([
	"hold",
	"push-slow",
	"push-punch",
	"pull-back",
	"pan-right",
	"pan-left",
	"drift-up",
	"drift-down",
]);
export type MotionType = typeof MotionType.Type;

// --- Pacing (docs/research/pacing.md) -------------------------------------------------------

export interface LengthRange {
	readonly minSec: number;
	readonly maxSec: number;
}

/**
 * Beat length per moment. Short in the hook, long in setup and vulnerable moments, shorter
 * through tension (the climax of film pacing), a long hold for the payoff and the CTA.
 */
export const BEAT_LENGTH: Readonly<Record<Moment, LengthRange>> = {
	hook: { minSec: 0.8, maxSec: 1.5 },
	setup: { minSec: 2.5, maxSec: 4 },
	tension: { minSec: 0.8, maxSec: 2 },
	twist: { minSec: 1.5, maxSec: 4 },
	vulnerable: { minSec: 4, maxSec: 6 },
	payoff: { minSec: 2, maxSec: 3 },
	cta: { minSec: 2, maxSec: 6 },
};

/** Beats with no moment yet: the phrase length `beat plan` cuts to. */
export const DEFAULT_BEAT_LENGTH: LengthRange = { minSec: 1.5, maxSec: 3 };

// --- Frame ---------------------------------------------------------------------------------

/** Every draft and clip: vertical 1080×1920 at 30 frames per second. */
export const FRAME = { width: 1080, height: 1920, fps: 30 } as const;

/**
 * Images are made about 25% larger than the frame, in multiples of 16, so motion never reaches
 * an edge or needs upscaling past the image (docs/research/motion.md).
 */
export const IMAGE_SIZE = { width: 1344, height: 2400 } as const;

/**
 * How many frames a beat gets: round(end·fps) − round(start·fps). Counting from absolute times
 * means rounding errors never add up, so the pictures stay in sync with the audio.
 */
export const framesOf = (beat: { readonly start: number; readonly end: number }): number =>
	Math.max(1, Math.round(beat.end * FRAME.fps) - Math.round(beat.start * FRAME.fps));

// --- Motion (docs/research/motion.md) ------------------------------------------------------

export const Motion = Schema.Struct({
	type: MotionType,
	/** Zoom or travel speed, percent of the frame per second (calm 1–2.5, neutral 3–4). */
	ratePctPerSec: Schema.Finite,
});
export type Motion = typeof Motion.Type;

/** Motion per moment; a beat's own `motion` replaces the type, keeping the moment's rate. */
export const MOTION_BY_MOMENT: Readonly<Record<Moment, Motion>> = {
	hook: { type: "push-punch", ratePctPerSec: 0 },
	setup: { type: "push-slow", ratePctPerSec: 2.5 },
	tension: { type: "push-slow", ratePctPerSec: 4 },
	twist: { type: "push-punch", ratePctPerSec: 0 },
	vulnerable: { type: "push-slow", ratePctPerSec: 1 },
	payoff: { type: "pull-back", ratePctPerSec: 3 },
	cta: { type: "drift-up", ratePctPerSec: 3 },
};

export const DEFAULT_MOTION: Motion = { type: "push-slow", ratePctPerSec: 2.5 };

/** One still in a video: when it shows, which image (relative to the post folder), how it moves. */
export const RenderBeat = Schema.Struct({
	start: Schema.Finite,
	end: Schema.Finite,
	image: Schema.String,
	motion: Motion,
});
export type RenderBeat = typeof RenderBeat.Type;

/** Upper bound on any zoom over one beat: more and stills look fake or soft. */
export const MAX_ZOOM = 0.15;
/** A punch-in reaches its zoom this fast, then holds. */
export const PUNCH = { zoom: 0.12, seconds: 0.45 } as const;
/** Zoom while panning or drifting, which sets how far the view can travel. */
export const TRAVEL_ZOOM = { pan: 0.08, drift: 0.06 } as const;

export const motionOf = (moment: Moment | undefined, override: MotionType | undefined): Motion => {
	const base = moment === undefined ? DEFAULT_MOTION : MOTION_BY_MOMENT[moment];
	if (override === undefined) return base;
	return {
		type: override,
		ratePctPerSec: base.ratePctPerSec > 0 ? base.ratePctPerSec : DEFAULT_MOTION.ratePctPerSec,
	};
};

// --- Captions (docs/research/captions.md) --------------------------------------------------

export const CAPTION_LIMITS = {
	maxWords: 4,
	/** Two lines of about 25 characters in a vertical frame. */
	maxChars: 42,
	/** Reading speed cap (Netflix's children's rate, the stricter of the standards). */
	maxCharsPerSec: 17,
	minSec: 0.8,
	maxSec: 1.6,
	/** A pause this long between words ends a caption. */
	pauseSec: 0.3,
} as const;

/**
 * Where text sits in a 1080×1920 frame, clear of every platform's interface: Reels keeps the
 * bottom 672 px and top 269 px, Shorts about 380 px top, and buttons take ~140 px on the right.
 */
export const CAPTION_LAYOUT = {
	/** Distance from the bottom to the caption block's bottom edge (block ends near y≈1160). */
	marginBottom: 760,
	marginLeft: 90,
	marginRight: 140,
	fontSize: 80,
	/** Highlighted word colour when `captions.highlight` is on (ASS &HBBGGRR: yellow). */
	highlightColour: "&H0000FFFF",
} as const;

export const HOOK_LAYOUT = {
	/** Distance from the top to the hook title, below the top interface zone. */
	marginTop: 420,
	fontSize: 96,
	minSec: 2,
	maxSec: 3,
	/** Reading time per word, the BBC rule of thumb. */
	secPerWord: 0.3,
} as const;

/** How long the hook title stays: enough to read it, within the first 3 seconds. */
export const hookDuration = (title: string): number => {
	const words = title.trim().split(/\s+/).filter(Boolean).length;
	return Math.min(
		HOOK_LAYOUT.maxSec,
		Math.max(HOOK_LAYOUT.minSec, words * HOOK_LAYOUT.secPerWord + 1),
	);
};
