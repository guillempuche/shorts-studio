import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { Context } from "../context.ts";
import { readLedger } from "../ledger.ts";
import { testContext } from "../test/context.ts";
import { fakeMediaTools, fakePorts, fakeTranscriber, run, runFailure } from "../test/fakes.ts";
import { savedPath, sourceTranscribe } from "./source-download.ts";

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
});
