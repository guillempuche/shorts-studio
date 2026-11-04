/**
 * Word-timed captions: short groups of words shown while they are spoken.
 *
 * Written twice from the same groups: ASS, burned into the draft by ffmpeg's `subtitles` filter
 * (libass), and SRT, the format CapCut desktop imports. Captions sit inside the vertical safe
 * zone: platforms cover the bottom ~480 px of a 1920 px frame with their own buttons and text
 * (content-studio constants/layout.ts).
 */

import type { Word } from "../domain/post.ts";

export interface CaptionGroup {
	readonly start: number;
	readonly end: number;
	readonly text: string;
}

export interface CaptionStyle {
	readonly font: string;
	readonly fontSize: number;
}

export const DEFAULT_CAPTION_STYLE: CaptionStyle = { font: "Arial", fontSize: 84 };

const MAX_WORDS = 4;
const MAX_SEC = 1.6;
const PAUSE_SEC = 0.3;
const PUNCTUATION_END = /[.!?,;:…]$/;
/** Captions closer than this to the next one stay up until it appears, to avoid flicker. */
const BRIDGE_SEC = 0.5;

export const groupCaptions = (words: ReadonlyArray<Word>): ReadonlyArray<CaptionGroup> => {
	const groups: Array<{ start: number; end: number; words: Array<string> }> = [];
	let current: { start: number; end: number; words: Array<string> } | undefined;
	words.forEach((word, i) => {
		current ??= { start: word.start, end: word.end, words: [] };
		current.words.push(word.text);
		current.end = word.end;
		const next = words[i + 1];
		const breakHere =
			next === undefined ||
			current.words.length >= MAX_WORDS ||
			current.end - current.start >= MAX_SEC ||
			next.start - word.end >= PAUSE_SEC ||
			PUNCTUATION_END.test(word.text);
		if (breakHere) {
			groups.push(current);
			current = undefined;
		}
	});
	return groups.map((group, i) => {
		const next = groups[i + 1];
		const end = next !== undefined && next.start - group.end < BRIDGE_SEC ? next.start : group.end;
		return { start: group.start, end, text: group.words.join(" ") };
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

export const toAss = (
	groups: ReadonlyArray<CaptionGroup>,
	style: CaptionStyle = DEFAULT_CAPTION_STYLE,
): string =>
	[
		"[Script Info]",
		"ScriptType: v4.00+",
		"PlayResX: 1080",
		"PlayResY: 1920",
		"WrapStyle: 0",
		"ScaledBorderAndShadow: yes",
		"",
		"[V4+ Styles]",
		"Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
		// White bold text with a black outline, centred, its baseline above the bottom safe zone.
		`Style: Caption,${style.font},${style.fontSize},&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,6,2,2,120,120,640,1`,
		"",
		"[Events]",
		"Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
		...groups.map(
			(g) => `Dialogue: 0,${assTime(g.start)},${assTime(g.end)},Caption,,0,0,0,,${assText(g.text)}`,
		),
		"",
	].join("\n");

export const toSrt = (groups: ReadonlyArray<CaptionGroup>): string =>
	groups
		.map((g, i) => `${i + 1}\n${srtTime(g.start)} --> ${srtTime(g.end)}\n${g.text}\n`)
		.join("\n");
