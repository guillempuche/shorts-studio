import { existsSync } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { Context } from "../context.ts";
import { readLedger, spent } from "../ledger.ts";
import { postDir, readPost } from "../post-store.ts";
import { testContext } from "../test/context.ts";
import {
	type FakeTranscriber,
	fakePorts,
	fakeTranscriber,
	run,
	runFailure,
} from "../test/fakes.ts";
import { seedPost } from "../test/posts.ts";
import { audioTranscribe, readTranscript } from "./audio.ts";

const SLUG = "2026-11-04-talk";
// Transcription needs no --yes, so these runs never confirm.
const MODE = { dryRun: false, confirmed: false } as const;

/** A post with two minutes of your own speech, and a transcriber that hears two words. */
const ready = async (
	ctx: Context = testContext(),
	transcriber: FakeTranscriber = fakeTranscriber(),
) => {
	await seedPost(ctx, SLUG, {
		audio: {
			file: "audio/audio.m4a",
			hash: "a",
			origin: "mine",
			kind: "speech",
			durationSec: 120,
			source: "talk.m4a",
		},
	});
	return { ctx, transcriber, ports: fakePorts({ transcriber }) };
};

const transcribe = (ctx: Context) =>
	audioTranscribe.run({ post: SLUG, language: undefined, force: false }, ctx, MODE);

const ledgerOf = (ctx: Context) => Effect.runPromise(readLedger(ctx));

describe("audio transcribe", () => {
	it("should write each word with its time, and record the transcript on the post", async () => {
		// GIVEN a post with audio
		const { ctx, ports } = await ready();

		// WHEN its audio is transcribed
		const result = await run(transcribe(ctx), ports);

		// THEN the transcript holds each word with its time
		const saved = await Effect.runPromise(readTranscript(ctx, SLUG));
		expect(saved.words.map((w) => w.text)).toEqual(["Hello", "there."]);
		expect(result.words).toBe(2);
		// AND the post records it, with the model that made it
		const post = await Effect.runPromise(readPost(ctx, SLUG));
		expect(post.transcript).toMatchObject({ model: "fake-whisper", language: "en" });
	});

	it("should reserve the model's price for the audio's minutes, without asking for --yes", async () => {
		// GIVEN a post with 2 minutes of audio, and a model at $0.006 a minute
		const { ctx, ports } = await ready();

		// WHEN its audio is transcribed, without --yes
		await run(transcribe(ctx), ports);

		// THEN 2 minutes at $0.006 were reserved for the post, and settled
		const entries = await ledgerOf(ctx);
		expect(entries.map((e) => e.type)).toEqual(["reserve", "settle"]);
		expect(entries[0]).toMatchObject({
			post: SLUG,
			model: "fake-whisper",
			unit: "minute",
			units: 2,
			usdPerUnit: 0.006,
		});
		expect(spent(entries, { post: SLUG })).toBeCloseTo(0.012);
	});

	it("should stop before sending the audio when it would pass the daily cap", async () => {
		// GIVEN a post with 2 minutes of audio ($0.012), and a daily cap of $0.01
		const { ctx, transcriber, ports } = await ready(
			testContext({ config: { caps: { dailyUsd: 0.01 } } }),
		);

		// WHEN its audio is transcribed
		const error = await runFailure(transcribe(ctx), ports);

		// THEN it fails as over budget
		expect(error.code).toBe("over-budget");
		// AND nothing was sent, reserved or written
		expect(transcriber.calls).toHaveLength(0);
		expect(await ledgerOf(ctx)).toHaveLength(0);
		expect(existsSync(join(postDir(ctx, SLUG), "transcript.json"))).toBe(false);
	});

	it("should not pay again for a transcript that's up to date", async () => {
		// GIVEN a post whose audio was transcribed
		const { ctx, transcriber, ports } = await ready();
		await run(transcribe(ctx), ports);

		// WHEN it is transcribed again
		const second = await run(transcribe(ctx), ports);

		// THEN it is skipped: the audio was sent once and reserved once
		expect(second.skipped).toBe(true);
		expect(transcriber.calls).toHaveLength(1);
		expect((await ledgerOf(ctx)).filter((e) => e.type === "reserve")).toHaveLength(1);
	});

	it("should free the reservation when the provider refuses the audio", async () => {
		// GIVEN a post with audio, and a provider that refuses it
		const { ctx, ports } = await ready(
			testContext(),
			fakeTranscriber(undefined, { refuses: true }),
		);

		// WHEN its audio is transcribed
		const error = await runFailure(transcribe(ctx), ports);

		// THEN it fails as a provider error, and nothing stays counted
		expect(error.code).toBe("provider");
		const entries = await ledgerOf(ctx);
		expect(entries.map((e) => e.type)).toEqual(["reserve", "release"]);
		expect(spent(entries, { post: SLUG })).toBe(0);
	});

	it("should say which key to set before reserving anything", async () => {
		// GIVEN a provider that needs a key that isn't set
		const transcriber = fakeTranscriber(undefined, {
			keys: [{ env: "FAKE_EARS_KEY", keychain: "fake-ears" }],
		});
		const { ctx, ports } = await ready(testContext(), transcriber);

		// WHEN its audio is transcribed
		const error = await runFailure(transcribe(ctx), ports);

		// THEN it names the key
		expect(error.code).toBe("missing-key");
		expect(error.message).toContain("FAKE_EARS_KEY");
		// AND nothing was reserved or sent
		expect(await ledgerOf(ctx)).toHaveLength(0);
		expect(transcriber.calls).toHaveLength(0);
	});
});
