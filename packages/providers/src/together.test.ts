import { truncateSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Model } from "@shorts-studio/domain/models";
import { Transcriber } from "@shorts-studio/usecases/ports";
import { tempDir } from "@shorts-studio/usecases/test/context";
import { transcriberContract } from "@shorts-studio/usecases/test/transcriber.contract";
import { Effect } from "effect";
import { describe, expect, it, onTestFinished } from "vitest";
import { withEnv } from "./env.ts";
import { providerContext } from "./test/context.ts";
import { startFakeTogether } from "./test/together-server.ts";
import { TOGETHER_MODELS, togetherLayer } from "./together.ts";

transcriberContract("Together", {
	make: async ({ answer, withKey }) => {
		const status = { words: undefined, refused: 400, unknown: 500 }[answer];
		const fake = await startFakeTogether(status === undefined ? {} : { status });
		onTestFinished(() => fake.close());
		const ctx = providerContext({
			endpoints: { together: fake.url },
			secrets: withKey ? { TOGETHER_API_KEY: "test-key" } : {},
		});
		return Effect.runPromise(
			Effect.gen(function* () {
				return yield* Transcriber;
			}).pipe(Effect.provide(withEnv(togetherLayer, ctx))),
		);
	},
});

describe("Together transcribe", () => {
	it("should refuse a file over 80 MB before uploading anything", async () => {
		// GIVEN Together with a key, and an 81 MB audio file
		const fake = await startFakeTogether();
		onTestFinished(() => fake.close());
		const ctx = providerContext({
			endpoints: { together: fake.url },
			secrets: { TOGETHER_API_KEY: "test-key" },
		});
		const together = await Effect.runPromise(
			Effect.gen(function* () {
				return yield* Transcriber;
			}).pipe(Effect.provide(withEnv(togetherLayer, ctx))),
		);
		const file = join(tempDir(), "long.m4a");
		writeFileSync(file, "");
		// A sparse file: its size is set without writing 81 MB.
		truncateSync(file, 81 * 1024 * 1024);

		// WHEN it is transcribed
		const error = await Effect.runPromise(
			Effect.flip(together.transcribe(TOGETHER_MODELS["openai/whisper-large-v3"], file, undefined)),
		);

		// THEN it is a usage error that gives both sizes in the same unit
		expect(error.code).toBe("usage");
		expect(error.message).toBe("long.m4a is 81.0 MB; Together accepts up to 80 MB.");
		// AND nothing reached Together
		expect(fake.authorizations).toHaveLength(0);
	});

	it("should ask for the model's id, so a model added in config.json needs no code", async () => {
		// GIVEN Together with a key, and a model it doesn't ship
		const fake = await startFakeTogether();
		onTestFinished(() => fake.close());
		const ctx = providerContext({
			endpoints: { together: fake.url },
			secrets: { TOGETHER_API_KEY: "test-key" },
		});
		const together = await Effect.runPromise(
			Effect.gen(function* () {
				return yield* Transcriber;
			}).pipe(Effect.provide(withEnv(togetherLayer, ctx))),
		);
		const added: Model = {
			provider: "together",
			job: "transcribe",
			endpoint: "openai/whisper-large-v3-turbo",
			billedBy: "minute",
			usdPerUnit: 0.001,
			priceChecked: "2026-11-07",
		};
		const file = join(tempDir(), "audio.m4a");
		writeFileSync(file, new Uint8Array(64));

		// WHEN a file is transcribed with it
		await Effect.runPromise(together.transcribe(added, file, undefined));

		// THEN Together was asked for that model's id
		expect(fake.models).toEqual(["openai/whisper-large-v3-turbo"]);
	});
});
