import { MediaTools } from "@shorts-studio/usecases/ports";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { withEnv } from "./env.ts";
import { ffmpegLayer } from "./ffmpeg.ts";
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
