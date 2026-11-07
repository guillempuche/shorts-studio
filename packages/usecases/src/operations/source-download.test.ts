import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { testContext } from "../test/context.ts";
import { run } from "../test/fakes.ts";
import { savedPath, sourceTranscribe } from "./source-download.ts";

const MODE = { dryRun: false, confirmed: true } as const;

describe("source transcribe", () => {
	it("should save each transcript with the model that made it", async () => {
		// GIVEN a saved collection with one downloaded audio file
		const ctx = testContext();
		const dir = savedPath(ctx, "sm-awareness");
		mkdirSync(join(dir, "audio"), { recursive: true });
		writeFileSync(join(dir, "audio", "abc.mp3"), "");

		// WHEN the collection is transcribed
		await run(sourceTranscribe.run({ collection: "sm-awareness", language: undefined }, ctx, MODE));

		// THEN the transcript names its model next to the words
		const saved = JSON.parse(readFileSync(join(dir, "transcripts", "abc.json"), "utf8"));
		expect(saved.model).toBe("fake-whisper");
		expect(saved.words).toHaveLength(2);
	});
});
