/**
 * What every transcription provider must do, as a test suite. A provider's test file runs it
 * with a harness that builds the provider in each state; the in-memory fake runs it too, so the
 * fake the use-case tests rely on can't drift from the real providers. Only tests import this.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Model } from "@shorts-studio/domain/models";
import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import type { Transcriber } from "../ports.ts";
import { tempDir } from "./context.ts";
import { defaultModelOf } from "./models.ts";

export interface TranscriberHarness {
	/** The provider, with its service answering with words or refusing, and with or without its key. */
	readonly make: (setup: {
		readonly answer: "words" | "refused";
		readonly withKey: boolean;
	}) => Promise<Transcriber["Service"]>;
}

/** A small audio file to send: providers read and upload it, fakes ignore what's in it. */
const audioFile = (): string => {
	const file = join(tempDir(), "audio.m4a");
	writeFileSync(file, new Uint8Array(64));
	return file;
};

export const transcriberContract = (name: string, harness: TranscriberHarness): void => {
	describe(`${name}, as a transcription provider`, () => {
		it("should offer whole transcription models of its own, with its default among them", async () => {
			// GIVEN the provider
			const transcriber = await harness.make({ answer: "words", withKey: true });

			// THEN its default model is one of its own
			expect(Object.keys(transcriber.models)).toContain(transcriber.defaultModel);
			// AND each of its models is a whole transcription model of this provider, with a price
			for (const [modelName, model] of Object.entries(transcriber.models)) {
				expect(Schema.is(Model)(model), modelName).toBe(true);
				expect(model.provider, modelName).toBe(transcriber.provider);
				expect(model.job, modelName).toBe("transcribe");
				expect(model.usdPerUnit, modelName).toBeGreaterThan(0);
			}
		});

		it("should return the language, the text and each word in order with its timing", async () => {
			// GIVEN a provider whose service hears speech
			const transcriber = await harness.make({ answer: "words", withKey: true });

			// WHEN a file is transcribed
			const transcript = await Effect.runPromise(
				transcriber.transcribe(defaultModelOf(transcriber), audioFile(), undefined),
			);

			// THEN it names the language and hears at least one word
			expect(transcript.language).not.toBe("");
			expect(transcript.words.length).toBeGreaterThan(0);
			// AND every word has text and a start no later than its end, in order
			transcript.words.forEach((word, index) => {
				expect(word.text).not.toBe("");
				expect(word.start).toBeLessThanOrEqual(word.end);
				const previous = transcript.words[index - 1];
				if (previous !== undefined) expect(word.start).toBeGreaterThanOrEqual(previous.start);
			});
		});

		it("should fail as a provider error with a fix when the service refuses", async () => {
			// GIVEN a provider whose service refuses the request
			const transcriber = await harness.make({ answer: "refused", withKey: true });

			// WHEN a file is transcribed
			const error = await Effect.runPromise(
				Effect.flip(transcriber.transcribe(defaultModelOf(transcriber), audioFile(), undefined)),
			);

			// THEN it is a provider failure that says what to do
			expect(error.code).toBe("provider");
			expect(error.fix).not.toBe("");
		});

		it("should say which key to set when its key is missing", async (test) => {
			// GIVEN the provider without its key
			const transcriber = await harness.make({ answer: "words", withKey: false });
			// A provider that needs no key can't miss one.
			if (transcriber.keys.length === 0) test.skip();

			// WHEN a file is transcribed
			const error = await Effect.runPromise(
				Effect.flip(transcriber.transcribe(defaultModelOf(transcriber), audioFile(), undefined)),
			);

			// THEN it fails with missing-key, naming the key
			expect(error.code).toBe("missing-key");
			expect(error.message).toContain(transcriber.keys[0]?.env);
		});
	});
};
