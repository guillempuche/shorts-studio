/** ffmpeg's level and track checks on real files: pnpm test:integration (needs ffmpeg). */

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { SILENT_DB } from "@shorts-studio/usecases/operations/source";
import { MediaTools } from "@shorts-studio/usecases/ports";
import { tempDir } from "@shorts-studio/usecases/test/context";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { withEnv } from "./env.ts";
import { ffmpegLayer } from "./ffmpeg.ts";
import { providerContext } from "./test/context.ts";

const media = () =>
	Effect.runPromise(
		Effect.gen(function* () {
			return yield* MediaTools;
		}).pipe(Effect.provide(withEnv(ffmpegLayer, providerContext()))),
	);

/** A two-second file made by ffmpeg from `lavfi` sources, e.g. a tone or silence. */
const generated = (
	name: string,
	inputs: ReadonlyArray<string>,
	extra: ReadonlyArray<string> = [],
) => {
	const file = join(tempDir(), name);
	execFileSync("ffmpeg", [
		"-hide_banner",
		"-loglevel",
		"error",
		"-y",
		...inputs,
		"-t",
		"2",
		...extra,
		file,
	]);
	return file;
};

describe("ffmpeg on real files", () => {
	it("should hear a tone, with one audio track", async () => {
		// GIVEN a 440 Hz tone
		const tone = generated("tone.m4a", ["-f", "lavfi", "-i", "sine=frequency=440"]);
		const tools = await media();

		// WHEN its tracks and level are read
		// THEN it has one track, and peaks well above silence
		expect(await Effect.runPromise(tools.audioStreams(tone))).toBe(1);
		expect(await Effect.runPromise(tools.peakDb(tone))).toBeGreaterThan(SILENT_DB);
	});

	it("should find silence silent", async () => {
		// GIVEN two seconds of silence
		const silence = generated("silence.m4a", ["-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono"]);

		// WHEN its level is read
		// THEN it is at or below the silence threshold
		expect(await Effect.runPromise((await media()).peakDb(silence))).toBeLessThanOrEqual(SILENT_DB);
	});

	it("should find no audio track in a video without sound", async () => {
		// GIVEN a video with no audio
		const video = generated("mute.mp4", ["-f", "lavfi", "-i", "color=c=black:s=64x64"], ["-an"]);

		// WHEN its tracks are counted
		// THEN there are none
		expect(await Effect.runPromise((await media()).audioStreams(video))).toBe(0);
	});

	it("should not read a text file as audio", async () => {
		// GIVEN a text file
		const text = join(tempDir(), "notes.txt");
		writeFileSync(text, "hello\n");

		// WHEN its tracks are counted
		// THEN there's no answer
		expect(await Effect.runPromise((await media()).audioStreams(text))).toBeUndefined();
	});
});
