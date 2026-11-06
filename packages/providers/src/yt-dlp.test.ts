import { Downloader } from "@shorts-studio/usecases/ports";
import { tempDir } from "@shorts-studio/usecases/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { withEnv } from "./env.ts";
import { providerContext } from "./testing.ts";
import { ytDlpLayer } from "./yt-dlp.ts";

/** yt-dlp's downloader with a stand-in for the program that records the arguments it gets. */
const recordingDownloader = async () => {
	const calls: Array<ReadonlyArray<string>> = [];
	const ctx = providerContext({
		run: async (_file, args) => {
			calls.push(args);
			return { code: 0, stdout: "", stderr: "" };
		},
	});
	const downloader = await Effect.runPromise(
		Effect.gen(function* () {
			return yield* Downloader;
		}).pipe(Effect.provide(withEnv(ytDlpLayer, ctx))),
	);
	return { calls, downloader };
};

describe("yt-dlp downloadOne", () => {
	it("should pass the URL after `--`, so one starting with '-' can't be read as an option", async () => {
		// GIVEN yt-dlp, recorded instead of run
		const { calls, downloader } = await recordingDownloader();

		// WHEN one post is downloaded from a "URL" that looks like an option
		await Effect.runPromise(
			downloader.downloadOne({ cwd: tempDir(), url: "--exec=touch x", output: "%(id)s.%(ext)s" }),
		);

		// THEN yt-dlp gets it after `--`, the end of its options (the call is what reaches yt-dlp)
		expect(calls[0]?.slice(-2)).toEqual(["--", "--exec=touch x"]);
	});
});
