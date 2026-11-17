import { truncateSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Model } from "@shorts-studio/domain/models";
import { Transcriber } from "@shorts-studio/usecases/ports";
import { tempDir } from "@shorts-studio/usecases/test/context";
import { transcriberContract } from "@shorts-studio/usecases/test/transcriber.contract";
import { Effect } from "effect";
import { describe, expect, it, onTestFinished } from "vitest";
import { withEnv } from "./env.ts";
import { closedUrl, providerContext } from "./test/context.ts";
import { startFakeTogether } from "./test/together-server.ts";
import { TOGETHER_MODELS, togetherLayer } from "./together.ts";

/** Together's provider talking to `url`, with its key unless `withKey` is false. */
const togetherAt = (url: string, withKey = true) =>
	Effect.runPromise(
		Effect.gen(function* () {
			return yield* Transcriber;
		}).pipe(
			Effect.provide(
				withEnv(
					togetherLayer,
					providerContext({
						endpoints: { together: url },
						secrets: withKey ? { TOGETHER_API_KEY: "test-key" } : {},
					}),
				),
			),
		),
	);

/** Together's provider talking to a local fake that answers every upload with `status`. */
const withFakeTogether = async (status?: number, withKey = true) => {
	const fake = await startFakeTogether(status === undefined ? {} : { status });
	onTestFinished(() => fake.close());
	return { fake, together: await togetherAt(fake.url, withKey) };
};

transcriberContract("Together", {
	make: async ({ answer, withKey }) => {
		if (answer === "unreachable") return togetherAt(await closedUrl(), withKey);
		const status = { words: undefined, refused: 400, unknown: 500 }[answer];
		return (await withFakeTogether(status, withKey)).together;
	},
});

/** A small audio file to upload. */
const audioFile = () => {
	const file = join(tempDir(), "audio.m4a");
	writeFileSync(file, new Uint8Array(64));
	return file;
};

const whisper = TOGETHER_MODELS["openai/whisper-large-v3"];

describe("Together's fixes", () => {
	it.each([
		[401, "Together refused the request, so nothing was counted.", "TOGETHER_API_KEY"],
		[429, "Together refused the request, so nothing was counted.", "wait a minute"],
		[502, "The outcome is unknown, so its cost stays counted.", "pays for a new request"],
	])(
		"should say whether an HTTP %i was counted, and what to do next",
		async (status, first, next) => {
			// GIVEN Together answering every upload with that status
			const { together } = await withFakeTogether(status);

			// WHEN a file is transcribed
			const error = await Effect.runPromise(
				Effect.flip(together.transcribe(whisper, audioFile(), undefined)),
			);

			// THEN the fix starts by saying whether it was counted, then what to do
			expect(error.fix.slice(0, first.length)).toBe(first);
			expect(error.fix).toContain(next);
		},
	);

	it("should say a refused connection sent nothing, and to tell the user", async () => {
		// GIVEN Together at an address where nothing listens any more
		const together = await togetherAt(await closedUrl());

		// WHEN a file is transcribed
		const error = await Effect.runPromise(
			Effect.flip(together.transcribe(whisper, audioFile(), undefined)),
		);

		// THEN it sent nothing, and the fix says so, that Together can't be reached, and to tell the user
		expect(error.reason._tag).toBe("NotSent");
		const first = "Nothing was sent, so nothing was counted.";
		expect(error.fix.slice(0, first.length)).toBe(first);
		expect(error.fix).toContain("Together can't be reached");
		expect(error.fix).toContain("SHORTS_TOGETHER_URL");
		expect(error.fix).toContain("Tell the user");
	});
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
