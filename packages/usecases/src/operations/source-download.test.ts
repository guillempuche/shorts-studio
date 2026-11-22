import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { Context } from "../context.ts";
import { daysNow } from "../days.ts";
import { readLedger, spent } from "../ledger.ts";
import { BROKEN_CONFIG, testContext } from "../test/context.ts";
import {
	fakeDownloader,
	fakeMediaTools,
	fakePorts,
	fakeTranscriber,
	run,
	runFailure,
} from "../test/fakes.ts";
import { savedPath, sourceDownload, sourceTranscribe } from "./source-download.ts";

// Transcription needs no --yes, so these runs never confirm.
const MODE = { dryRun: false, confirmed: false } as const;

/** A saved collection with these downloaded audio files. Returns its folder. */
const seedCollection = (ctx: Context, files: ReadonlyArray<string>): string => {
	const dir = savedPath(ctx, "sm-awareness");
	mkdirSync(join(dir, "audio"), { recursive: true });
	for (const file of files) writeFileSync(join(dir, "audio", file), "");
	return dir;
};

/** Every file 90 seconds long: $0.009 each with the fake's $0.006 a minute. */
const ninetySeconds = () => fakePorts({ mediaTools: fakeMediaTools({ durationSec: 90 }) });

const transcribeCollection = (ctx: Context) =>
	sourceTranscribe.run({ collection: "sm-awareness", language: undefined }, ctx, MODE);

describe("source transcribe", () => {
	it("should save each transcript with the model that made it", async () => {
		// GIVEN a saved collection with one downloaded audio file
		const ctx = testContext();
		const dir = seedCollection(ctx, ["abc.mp3"]);

		// WHEN the collection is transcribed
		await run(transcribeCollection(ctx));

		// THEN the transcript names its model next to the words
		const saved = JSON.parse(readFileSync(join(dir, "transcripts", "abc.json"), "utf8"));
		expect(saved.model).toBe("fake-whisper");
		expect(saved.words).toHaveLength(2);
	});

	it("should refuse a language that isn't a two-letter code, before sending anything", async () => {
		// GIVEN a collection with one file
		const ctx = testContext();
		seedCollection(ctx, ["abc.mp3"]);
		const transcriber = fakeTranscriber();

		// WHEN it is transcribed with the language "spanish"
		const error = await runFailure(
			sourceTranscribe.run({ collection: "sm-awareness", language: "spanish" }, ctx, MODE),
			fakePorts({ transcriber }),
		);

		// THEN it is a usage error that says what to use
		expect(error.code).toBe("usage");
		expect(error.fix).toContain("es, en, ca");
		// AND nothing was sent or reserved
		expect(transcriber.calls).toHaveLength(0);
		expect(await Effect.runPromise(readLedger(ctx))).toHaveLength(0);
	});

	it("should report the price of every file left to transcribe on a dry run, and spend nothing", async () => {
		// GIVEN a collection with two 90-second files, one already transcribed
		const ctx = testContext();
		const dir = seedCollection(ctx, ["a.mp3", "b.mp3"]);
		mkdirSync(join(dir, "transcripts"), { recursive: true });
		writeFileSync(join(dir, "transcripts", "a.json"), "{}");
		const transcriber = fakeTranscriber();

		// WHEN it is transcribed as a dry run
		const result = await run(
			sourceTranscribe.run({ collection: "sm-awareness", language: undefined }, ctx, {
				dryRun: true,
				confirmed: false,
			}),
			fakePorts({ transcriber, mediaTools: fakeMediaTools({ durationSec: 90 }) }),
		);

		// THEN it reports one file to do at the price of 1.5 minutes
		expect(result).toMatchObject({ dryRun: true, transcribed: 0, skipped: 1, toTranscribe: 1 });
		expect(result.estimateUsd).toBeCloseTo(0.009);
		// AND nothing was sent or reserved
		expect(transcriber.calls).toHaveLength(0);
		expect(await Effect.runPromise(readLedger(ctx))).toHaveLength(0);
	});

	it("should count each file's minutes toward the collection", async () => {
		// GIVEN a collection with one 90-second file
		const ctx = testContext();
		seedCollection(ctx, ["abc.mp3"]);

		// WHEN it is transcribed
		await run(transcribeCollection(ctx), ninetySeconds());

		// THEN 1.5 minutes were reserved under saved/sm-awareness, and settled
		const entries = await Effect.runPromise(readLedger(ctx));
		expect(entries.map((e) => e.type)).toEqual(["reserve", "settle"]);
		expect(entries[0]).toMatchObject({ post: "saved/sm-awareness", units: 1.5, note: "abc.mp3" });
	});

	it("should stop at a spending cap, keeping the transcripts already written", async () => {
		// GIVEN two 90-second files ($0.009 each) and a daily cap of $0.01, which fits one
		const ctx = testContext({ config: { caps: { dailyUsd: 0.01 } } });
		const dir = seedCollection(ctx, ["a.mp3", "b.mp3"]);

		// WHEN the collection is transcribed
		const error = await runFailure(transcribeCollection(ctx), ninetySeconds());

		// THEN it stops as over budget
		expect(error.code).toBe("over-budget");
		// AND the first file's transcript stays, so the next run only does the second
		expect(existsSync(join(dir, "transcripts", "a.json"))).toBe(true);
		expect(existsSync(join(dir, "transcripts", "b.json"))).toBe(false);
	});

	it("should stop at the first file when the transcriber can't be reached, counting nothing", async () => {
		// GIVEN two files and a transcriber that can't be reached from this machine
		const ctx = testContext();
		const dir = seedCollection(ctx, ["a.mp3", "b.mp3"]);
		const transcriber = fakeTranscriber(undefined, { answer: "unreachable" });

		// WHEN the collection is transcribed
		const error = await runFailure(
			transcribeCollection(ctx),
			fakePorts({ transcriber, mediaTools: fakeMediaTools({ durationSec: 90 }) }),
		);

		// THEN it fails with that provider error after one attempt, since the next would fail the same way
		expect(error.code).toBe("provider");
		expect(transcriber.calls).toHaveLength(1);
		// AND today's total is unchanged, since nothing was sent
		const entries = await Effect.runPromise(readLedger(ctx));
		expect(spent(entries, { since: daysNow(ctx).startOfToday })).toBe(0);
		expect(existsSync(join(dir, "transcripts", "a.json"))).toBe(false);
	});

	it("should refuse before trying any file while a setting can't be used", async () => {
		// GIVEN a setting that couldn't be used, and a collection with one file
		const ctx = testContext({
			settingsIssues: [BROKEN_CONFIG],
		});
		seedCollection(ctx, ["a.mp3"]);
		const transcriber = fakeTranscriber();

		// WHEN the collection is transcribed
		const error = await runFailure(
			transcribeCollection(ctx),
			fakePorts({ transcriber, mediaTools: fakeMediaTools({ durationSec: 90 }) }),
		);

		// THEN it fails with the settings refusal, and no file reached the transcriber
		expect(error.code).toBe("failed");
		expect(error.fix).toContain("doctor");
		expect(transcriber.calls).toHaveLength(0);
	});

	it("should say on a dry run whether the files fit the caps", async () => {
		// GIVEN two 90-second files ($0.009 each) and a daily cap of $0.01, which fits one
		const ctx = testContext({ config: { caps: { dailyUsd: 0.01 } } });
		seedCollection(ctx, ["a.mp3", "b.mp3"]);

		// WHEN the collection is planned with a dry run
		const planned = await run(
			sourceTranscribe.run({ collection: "sm-awareness", language: undefined }, ctx, {
				dryRun: true,
				confirmed: false,
			}),
			ninetySeconds(),
		);

		// THEN its budget says the estimate doesn't fit, naming the daily cap
		expect(planned.budget).toMatchObject({ fits: false, stoppedBy: "caps.dailyUsd" });
	});
});

describe("source transcribe, saying what's next", () => {
	const dryRun = (ctx: Context) =>
		sourceTranscribe.run({ collection: "sm-awareness", language: undefined }, ctx, {
			dryRun: true,
			confirmed: false,
		});

	it("should make the real run the next step after a dry run that fits", async () => {
		// GIVEN a collection with one file
		const ctx = testContext();
		seedCollection(ctx, ["a.mp3"]);

		// WHEN it is planned with a dry run
		const planned = await run(dryRun(ctx));

		// THEN the next step is the same call for real
		expect(planned.nextSteps?.[0]).toMatchObject({
			by: "agent",
			tool: "source_transcribe",
			args: { collection: "sm-awareness" },
		});
		// AND its text ends with Next:
		expect(sourceTranscribe.render?.(planned).split("\n").at(-1)).toMatch(/^Next: /);
	});

	it("should list a file it can't read as failed, and still estimate the others", async () => {
		// GIVEN three files, one whose length can't be read
		const ctx = testContext();
		seedCollection(ctx, ["a.mp3", "b.mp3", "c.mp3"]);

		// WHEN it is planned with a dry run
		const planned = await run(
			dryRun(ctx),
			fakePorts({ mediaTools: fakeMediaTools({ durationSec: 90, unreadable: ["b.mp3"] }) }),
		);

		// THEN the other two are estimated, and b.mp3 is listed with its fix
		expect(planned.toTranscribe).toBe(2);
		expect(planned.estimateUsd).toBeCloseTo(0.018);
		expect(planned.failures).toEqual([
			{
				file: "b.mp3",
				error: expect.objectContaining({ code: "failed", fix: "Check that the file is audio." }),
			},
		]);
	});

	it("should give each failed file its error's fix, and offer to run it again", async () => {
		// GIVEN a collection whose files the transcriber refuses
		const ctx = testContext();
		seedCollection(ctx, ["a.mp3"]);
		const transcriber = fakeTranscriber(undefined, { answer: "refused" });

		// WHEN it is transcribed
		const result = await run(transcribeCollection(ctx), fakePorts({ transcriber }));

		// THEN the file is listed with the provider's fix
		expect(result.failures?.[0]).toMatchObject({
			file: "a.mp3",
			error: { code: "provider", fix: "Fix the request." },
		});
		// AND the next step runs it again
		expect(result.nextSteps?.[0]).toMatchObject({ tool: "source_transcribe" });
	});

	it("should say how many files it transcribed before a cap stopped it", async () => {
		// GIVEN five 90-second files ($0.009 each) and a daily cap of $0.02, which fits two
		const ctx = testContext({ config: { caps: { dailyUsd: 0.02 } } });
		seedCollection(ctx, ["a.mp3", "b.mp3", "c.mp3", "d.mp3", "e.mp3"]);

		// WHEN the collection is transcribed
		const error = await runFailure(transcribeCollection(ctx), ninetySeconds());

		// THEN it is over budget, saying two files were transcribed and kept
		expect(error.code).toBe("over-budget");
		expect(error.message).toContain("Transcribed 2 of 5 files before the cap; they're kept.");
	});

	it("should make the collection's download the user's step when it has no audio", async () => {
		// GIVEN a collection with no audio folder
		const ctx = testContext();

		// WHEN it is transcribed
		const error = await runFailure(transcribeCollection(ctx));

		// THEN the step is the user's CLI-only download
		expect(error.code).toBe("not-found");
		expect(error.fix).toMatch(/^Ask the user to /);
		expect(error.nextSteps[0]).toMatchObject({
			by: "user",
			cli: "source download --collection sm-awareness",
		});
	});
});

describe("source download", () => {
	const download = (
		ctx: Context,
		input: Partial<{ collection: string; url: string; post: string }>,
	) =>
		sourceDownload.run(
			{
				collection: input.collection,
				url: input.url,
				post: input.post,
				origin: undefined,
				kind: undefined,
			},
			ctx,
			MODE,
		);

	it.each([
		["holds only blank lines and comments", "\n# later\n  \n"],
		["is empty", ""],
	])("should refuse a urls.txt that %s, before running yt-dlp", async (_, text) => {
		// GIVEN a collection whose urls.txt holds no URL
		const ctx = testContext();
		const dir = savedPath(ctx, "faves");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "urls.txt"), text);
		const downloader = fakeDownloader();

		// WHEN it is downloaded
		const error = await runFailure(
			download(ctx, { collection: "faves" }),
			fakePorts({ downloader }),
		);

		// THEN it fails, saying to put one URL per line, and yt-dlp never ran
		expect(error.fix).toContain("one per line");
		expect(downloader.calls).toEqual([]);
	});

	it("should refuse a urls.txt that's a folder, before running yt-dlp", async () => {
		// GIVEN a collection whose urls.txt is a folder
		const ctx = testContext();
		mkdirSync(join(savedPath(ctx, "faves"), "urls.txt"), { recursive: true });
		const downloader = fakeDownloader();

		// WHEN it is downloaded
		const error = await runFailure(
			download(ctx, { collection: "faves" }),
			fakePorts({ downloader }),
		);

		// THEN it is a usage error, and yt-dlp never ran
		expect(error.code).toBe("usage");
		expect(downloader.calls).toEqual([]);
	});

	it("should fail with yt-dlp's errors when nothing new came down", async () => {
		// GIVEN a collection with a URL, and a yt-dlp that downloads nothing
		const ctx = testContext();
		const dir = savedPath(ctx, "faves");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "urls.txt"), "https://example.com/p/1\n");
		const downloader = fakeDownloader({ ok: false, errors: "cookies: no such browser" });

		// WHEN it is downloaded
		const error = await runFailure(
			download(ctx, { collection: "faves" }),
			fakePorts({ downloader }),
		);

		// THEN it fails as a provider failure carrying yt-dlp's lines
		expect(error.code).toBe("provider");
		expect(error.message).toContain("cookies: no such browser");
	});

	it.each([
		[{ url: "https://example.com/p/1" }, "--url needs --post"],
		[{ post: "2026-11-04-x" }, "--post needs --url"],
	])("should name what's missing when %o comes alone", async (input, says) => {
		// GIVEN no download running
		const ctx = testContext();
		const downloader = fakeDownloader();

		// WHEN only one of --url and --post is given
		const error = await runFailure(download(ctx, input), fakePorts({ downloader }));

		// THEN it is a usage error naming the one missing, and nothing ran
		expect(error.code).toBe("usage");
		expect(error.message).toContain(says);
		expect(downloader.calls).toEqual([]);
	});
});
