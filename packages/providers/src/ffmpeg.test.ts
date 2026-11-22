import { MediaTools } from "@shorts-studio/usecases/ports";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { withEnv } from "./env.ts";
import { ffmpegLayer, peakOf } from "./ffmpeg.ts";
import type { ProviderContext } from "./node.ts";
import { providerContext } from "./test/context.ts";

/** ffmpeg's MediaTools with a stand-in for running ffprobe and ffmpeg. */
const mediaToolsWith = (run: ProviderContext["run"]) =>
	Effect.runPromise(
		Effect.gen(function* () {
			return yield* MediaTools;
		}).pipe(Effect.provide(withEnv(ffmpegLayer, providerContext({ run })))),
	);

describe("ffmpeg duration", () => {
	it("should say the file is the problem when ffprobe runs but can't read it", async () => {
		// GIVEN an ffprobe that runs but can't read the file
		const media = await mediaToolsWith(async () => ({
			code: 1,
			stdout: "",
			stderr: "final.png: Invalid data found when processing input",
		}));

		// WHEN its duration is asked for
		const error = await Effect.runPromise(Effect.flip(media.duration("/videos/final.png")));

		// THEN it fails as a bad file, not as a missing tool
		expect(error.code).toBe("failed");
		expect(error.message).toContain("Invalid data");
		expect(error.fix).toContain("ffprobe can read");
	});

	it("should send the user to doctor when ffprobe can't start", async () => {
		// GIVEN no ffprobe on the PATH
		const media = await mediaToolsWith(() => Promise.reject(new Error("spawn ffprobe ENOENT")));

		// WHEN a duration is asked for
		const error = await Effect.runPromise(Effect.flip(media.duration("/videos/final.mp4")));

		// THEN it fails as a missing tool, with doctor as the next step
		expect(error.code).toBe("missing-tool");
		expect(error.fix).toContain("doctor");
	});
});

describe("ffmpeg audioStreams", () => {
	it("should count the audio tracks ffprobe lists", async () => {
		// GIVEN an ffprobe that lists two audio tracks
		const media = await mediaToolsWith(async () => ({ code: 0, stdout: "1\n2\n", stderr: "" }));

		// WHEN the tracks are counted
		// THEN there are two
		expect(await Effect.runPromise(media.audioStreams("/videos/two.mov"))).toBe(2);
	});

	it("should find none in a video without sound", async () => {
		// GIVEN an ffprobe that lists no audio track
		const media = await mediaToolsWith(async () => ({ code: 0, stdout: "", stderr: "" }));

		// WHEN the tracks are counted
		// THEN there are none
		expect(await Effect.runPromise(media.audioStreams("/videos/mute.mp4"))).toBe(0);
	});

	it("should say a file ffprobe can't read isn't audio or video", async () => {
		// GIVEN an ffprobe that can't read the file
		const media = await mediaToolsWith(async () => ({
			code: 1,
			stdout: "",
			stderr: "notes.txt: Invalid data found when processing input",
		}));

		// WHEN the tracks are counted
		// THEN there's no answer, rather than a failure
		expect(await Effect.runPromise(media.audioStreams("/notes.txt"))).toBeUndefined();
	});
});

describe("ffmpeg peakDb", () => {
	it("should read volumedetect's max_volume", async () => {
		// GIVEN an ffmpeg whose volumedetect reports a peak of -3.2 dB
		const media = await mediaToolsWith(async () => ({
			code: 0,
			stdout: "",
			stderr:
				"[Parsed_volumedetect_0 @ 0x1] mean_volume: -20.1 dB\n[Parsed_volumedetect_0 @ 0x1] max_volume: -3.2 dB\n",
		}));

		// WHEN the peak is measured
		// THEN it is -3.2
		expect(await Effect.runPromise(media.peakDb("/a.m4a"))).toBe(-3.2);
	});

	it("should read pure zeros as minus infinity", () => {
		// GIVEN volumedetect's line for pure digital silence
		// THEN it reads as -Infinity
		expect(peakOf("max_volume: -inf dB")).toBe(Number.NEGATIVE_INFINITY);
	});

	it("should fail as a bad file when ffmpeg prints no level", async () => {
		// GIVEN an ffmpeg that can't read the file
		const media = await mediaToolsWith(async () => ({
			code: 1,
			stdout: "",
			stderr: "a.m4a: Invalid data",
		}));

		// WHEN the peak is measured
		const error = await Effect.runPromise(Effect.flip(media.peakDb("/a.m4a")));

		// THEN it fails as a bad file
		expect(error.code).toBe("failed");
		expect(error.message).toContain("Invalid data");
	});
});
