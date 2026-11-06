import { configCheck } from "@shorts-studio/usecases/operations/config";
import { ImageMaker, Transcriber } from "@shorts-studio/usecases/ports";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { providersLayer } from "./index.ts";
import { providerContext } from "./testing.ts";

const MODE = { dryRun: false, confirmed: true } as const;
const notInstalled = () => Promise.reject(new Error("spawn ENOENT"));

describe("providersLayer", () => {
	it("should have doctor name a missing ffmpeg and the default providers' missing keys", async () => {
		// GIVEN a machine with no ffmpeg, ffprobe or yt-dlp, and no keys, on the default settings
		const ctx = providerContext({ run: notInstalled });

		// WHEN doctor runs with the providers the settings choose
		const error = await Effect.runPromise(
			Effect.flip(configCheck.run({}, ctx, MODE)).pipe(Effect.provide(providersLayer(ctx))),
		);

		// THEN it fails naming ffmpeg, FAL's key and Together's key, each with a fix
		expect(error.code).toBe("missing-tool");
		expect(error.message).toMatch(/✗ ffmpeg +not found\n +→ /);
		expect(error.message).toMatch(/✗ FAL_KEY +missing \(fal needs it\)/);
		expect(error.message).toMatch(/✗ TOGETHER_API_KEY +missing \(together needs it\)/);
	});

	it("should make every call fail with a fix when the settings name an unknown provider", async () => {
		// GIVEN config.json asking for image and transcription providers that don't exist
		const ctx = providerContext({
			config: { image: { provider: "nope" }, transcribe: { provider: "nada" } },
		});
		const ports = providersLayer(ctx);

		// WHEN an image is submitted and a file transcribed
		const image = await Effect.runPromise(
			Effect.flip(ImageMaker.use((maker) => maker.submit("m", "a red door", 1))).pipe(
				Effect.provide(ports),
			),
		);
		const transcript = await Effect.runPromise(
			Effect.flip(
				Transcriber.use((transcriber) => transcriber.transcribe("a.m4a", undefined)),
			).pipe(Effect.provide(ports)),
		);

		// THEN both are usage errors that list the providers that exist
		expect(image.code).toBe("usage");
		expect(image.fix).toBe("Set image.provider in config.json to one of: fal.");
		expect(transcript.code).toBe("usage");
		expect(transcript.fix).toBe("Set transcribe.provider in config.json to one of: together.");
	});

	it("should have doctor report an unknown provider", async () => {
		// GIVEN config.json asking for an image provider that doesn't exist
		const ctx = providerContext({ config: { image: { provider: "nope" } } });

		// WHEN doctor runs
		const error = await Effect.runPromise(
			Effect.flip(configCheck.run({}, ctx, MODE)).pipe(Effect.provide(providersLayer(ctx))),
		);

		// THEN it names the provider that doesn't exist
		expect(error.message).toContain('No image provider is called "nope".');
	});
});
