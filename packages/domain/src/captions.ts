/**
 * Word-timed captions: short groups of words shown while they are spoken, plus an optional
 * hook title for the first seconds.
 *
 * Written twice from the same groups: ASS, burned into the draft by ffmpeg's `subtitles` filter
 * (libass), and SRT, the format CapCut desktop imports. Limits and placement come from
 * src/domain/direction.ts; the evidence is in docs/research/captions.md.
 */

import { CAPTION_LAYOUT, CAPTION_LIMITS, HOOK_LAYOUT, hookDuration } from "./direction.ts";
import type { Word } from "./post.ts";

export interface CaptionGroup {
	readonly start: number;
	readonly end: number;
	readonly text: string;
	/** The words with their own timings, for word-by-word highlighting. */
	readonly words: ReadonlyArray<Word>;
}

export interface CaptionStyle {
	readonly font: string;
	readonly fontSize: number;
	/** Colour each word as it's spoken (karaoke); off by default, see captions.md. */
	readonly highlight: boolean;
}

export const DEFAULT_CAPTION_STYLE: CaptionStyle = {
	font: "Arial",
	fontSize: CAPTION_LAYOUT.fontSize,
	highlight: false,
};

const PUNCTUATION_END = /[.!?,;:…]$/;
/** Captions closer than this to the next one stay up until it appears, to avoid flicker. */
const BRIDGE_SEC = 0.5;

const textOf = (words: ReadonlyArray<Word>): string => words.map((w) => w.text).join(" ");

/** Groups words into captions within the reading limits. */
export const groupCaptions = (words: ReadonlyArray<Word>): ReadonlyArray<CaptionGroup> => {
	const raw: Array<Array<Word>> = [];
	let current: Array<Word> = [];
	words.forEach((word, i) => {
		const next = words[i + 1];
		// Start a new caption rather than overflow the two lines.
		if (current.length > 0 && textOf([...current, word]).length > CAPTION_LIMITS.maxChars) {
			raw.push(current);
			current = [];
		}
		current.push(word);
		const first = current[0] as Word;
		const breakHere =
			next === undefined ||
			current.length >= CAPTION_LIMITS.maxWords ||
			word.end - first.start >= CAPTION_LIMITS.maxSec ||
			next.start - word.end >= CAPTION_LIMITS.pauseSec ||
			PUNCTUATION_END.test(word.text);
		if (breakHere) {
			raw.push(current);
			current = [];
		}
	});

	// A word on its own is hard to follow: join it to the caption before, unless it ends the audio.
	const merged: Array<Array<Word>> = [];
	raw.forEach((group, i) => {
		const previous = merged.at(-1);
		const isLast = i === raw.length - 1;
		if (group.length === 1 && previous !== undefined && !isLast) {
			if (textOf([...previous, ...group]).length <= CAPTION_LIMITS.maxChars) {
				previous.push(...group);
				return;
			}
		}
		merged.push([...group]);
	});

	return merged.map((group, i) => {
		const start = (group[0] as Word).start;
		const spokenEnd = (group.at(-1) as Word).end;
		const next = merged[i + 1];
		const nextStart = next === undefined ? Number.POSITIVE_INFINITY : (next[0] as Word).start;
		// Long enough to read (characters per second, and a floor), without overlapping the next.
		const readable = Math.max(
			CAPTION_LIMITS.minSec,
			textOf(group).length / CAPTION_LIMITS.maxCharsPerSec,
		);
		let end = Math.max(spokenEnd, start + readable);
		if (nextStart - spokenEnd < BRIDGE_SEC) end = Math.max(end, nextStart);
		end = Math.min(end, nextStart);
		return { start, end, text: textOf(group), words: group };
	});
};

const assTime = (seconds: number): string => {
	const cs = Math.round(seconds * 100);
	const h = Math.floor(cs / 360_000);
	const m = Math.floor((cs % 360_000) / 6000);
	const s = Math.floor((cs % 6000) / 100);
	return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
};

const srtTime = (seconds: number): string => {
	const ms = Math.round(seconds * 1000);
	const h = Math.floor(ms / 3_600_000);
	const m = Math.floor((ms % 3_600_000) / 60_000);
	const s = Math.floor((ms % 60_000) / 1000);
	return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
};

/** Braces start ASS override tags, so caption text can't contain them. */
const assText = (text: string): string => text.replace(/[{}]/g, "").replace(/\n/g, "\\N");

/** Each word preceded by a karaoke tag lasting until the next word starts. */
const karaoke = (group: CaptionGroup): string =>
	group.words
		.map((word, i) => {
			const until = group.words[i + 1]?.start ?? group.end;
			const cs = Math.max(1, Math.round((until - word.start) * 100));
			const lead = i === 0 ? Math.max(0, Math.round((word.start - group.start) * 100)) : 0;
			return `${lead > 0 ? `{\\k${lead}}` : ""}{\\k${cs}}${assText(word.text)}`;
		})
		.join(" ");

export const toAss = (
	groups: ReadonlyArray<CaptionGroup>,
	style: CaptionStyle = DEFAULT_CAPTION_STYLE,
	hook?: string,
): string => {
	// In karaoke, text shows in the secondary colour and turns primary as it's spoken.
	const primary = style.highlight ? CAPTION_LAYOUT.highlightColour : "&H00FFFFFF";
	const hookText = hook?.trim();
	return [
		"[Script Info]",
		"ScriptType: v4.00+",
		"PlayResX: 1080",
		"PlayResY: 1920",
		"WrapStyle: 0",
		"ScaledBorderAndShadow: yes",
		"",
		"[V4+ Styles]",
		"Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
		// White bold text, black outline, centred, its bottom edge above every platform's bottom zone.
		`Style: Caption,${style.font},${style.fontSize},${primary},&H00FFFFFF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,6,2,2,${CAPTION_LAYOUT.marginLeft},${CAPTION_LAYOUT.marginRight},${CAPTION_LAYOUT.marginBottom},1`,
		// The hook title: top centre, below the platforms' top zone.
		`Style: Hook,${style.font},${HOOK_LAYOUT.fontSize},&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,7,2,8,${CAPTION_LAYOUT.marginLeft},${CAPTION_LAYOUT.marginRight},${HOOK_LAYOUT.marginTop},1`,
		"",
		"[Events]",
		"Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
		...(hookText
			? [
					`Dialogue: 1,${assTime(0)},${assTime(hookDuration(hookText))},Hook,,0,0,0,,${assText(hookText)}`,
				]
			: []),
		...groups.map(
			(g) =>
				`Dialogue: 0,${assTime(g.start)},${assTime(g.end)},Caption,,0,0,0,,${style.highlight ? karaoke(g) : assText(g.text)}`,
		),
		"",
	].join("\n");
};

export const toSrt = (groups: ReadonlyArray<CaptionGroup>): string =>
	groups
		.map((g, i) => `${i + 1}\n${srtTime(g.start)} --> ${srtTime(g.end)}\n${g.text}\n`)
		.join("\n");
