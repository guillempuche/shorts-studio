/**
 * Transcription with word timestamps on Together.ai (Whisper large-v3).
 *
 * `verbose_json` with `timestamp_granularities=word` returns every word with its start and end
 * (docs.together.ai, "Create audio transcription request"). Uploads are capped at 80 MB.
 */

import { openAsBlob, statSync } from "node:fs";
import { basename } from "node:path";
import type { Context } from "../core/context.ts";
import type { Word } from "../domain/post.ts";

export const TOGETHER_MODEL = "openai/whisper-large-v3";
export const MAX_UPLOAD_BYTES = 80 * 1024 * 1024;

export interface Transcript {
	readonly language: string;
	readonly text: string;
	readonly words: ReadonlyArray<Word>;
}

export class TranscriptionError extends Error {}

export const transcribe = async (
	ctx: Context,
	key: string,
	file: string,
	language: string | undefined,
	signal?: AbortSignal,
): Promise<Transcript> => {
	const size = statSync(file).size;
	if (size > MAX_UPLOAD_BYTES) {
		throw new TranscriptionError(
			`${basename(file)} is ${(size / 1e6).toFixed(0)} MB; Together accepts up to 80 MB.`,
		);
	}
	const form = new FormData();
	form.append("file", await openAsBlob(file), basename(file));
	form.append("model", TOGETHER_MODEL);
	form.append("response_format", "verbose_json");
	form.append("timestamp_granularities", "word");
	form.append("language", language ?? "auto");

	const response = await ctx.fetch(`${ctx.endpoints.together}/v1/audio/transcriptions`, {
		method: "POST",
		headers: { Authorization: `Bearer ${key}` },
		body: form,
		...(signal ? { signal } : {}),
	});
	const text = await response.text();
	if (!response.ok) {
		throw new TranscriptionError(
			`Together transcription failed (HTTP ${response.status}): ${text.slice(0, 300)}`,
		);
	}
	const body = JSON.parse(text) as {
		language?: string;
		text?: string;
		words?: ReadonlyArray<{ word?: string; text?: string; start?: number; end?: number }>;
	};
	const words = (body.words ?? [])
		.map((w) => ({ text: (w.word ?? w.text ?? "").trim(), start: w.start ?? 0, end: w.end ?? 0 }))
		.filter((w) => w.text !== "");
	if (words.length === 0) {
		throw new TranscriptionError(
			"Together returned no word timings (is there speech in the audio?).",
		);
	}
	return { language: body.language ?? language ?? "unknown", text: body.text?.trim() ?? "", words };
};
