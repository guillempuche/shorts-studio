import { Downloader } from "@shorts-studio/usecases/ports";
import { tempDir } from "@shorts-studio/usecases/test/context";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { withEnv } from "./env.ts";
import { providerContext } from "./test/context.ts";
import { errorLines, ytDlpLayer } from "./yt-dlp.ts";

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

describe("yt-dlp errors", () => {
	it("should keep the lines that say ERROR", () => {
		// GIVEN stderr with an ERROR line among others
		// THEN only that line is kept
		expect(errorLines("[info] one\nERROR: private video\n[info] two\n")).toBe(
			"ERROR: private video",
		);
	});

	it("should fall back to the last five lines when none says ERROR", async () => {
		// GIVEN a yt-dlp that fails with seven lines on stderr, none saying ERROR
		const stderr = ["1", "2", "3", "4", "5", "6", "no such browser: firefx"].join("\n");
		const ctx = providerContext({ run: async () => ({ code: 1, stdout: "", stderr }) });
		const downloader = await Effect.runPromise(
			Effect.gen(function* () {
				return yield* Downloader;
			}).pipe(Effect.provide(withEnv(ytDlpLayer, ctx))),
		);

		// WHEN a collection is downloaded
		const result = await Effect.runPromise(
			downloader.downloadList({
				cwd: tempDir(),
				urlsFile: "urls.txt",
				archiveFile: "downloaded.txt",
				output: "audio/%(id)s.%(ext)s",
			}),
		);

		// THEN it failed, and its errors are the last five lines
		expect(result.ok).toBe(false);
		expect(result.errors).toBe(["3", "4", "5", "6", "no such browser: firefx"].join("\n"));
	});
});
