/**
 * Test helpers for the use cases: a `Context` in a temporary folder, in-memory fakes of every
 * port, and posts seeded at a given stage. A use case then runs without keys, ffmpeg or the
 * network. Only tests import this file.
 */

import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fail, failBecause, RequestEnded } from "@shorts-studio/domain/errors";
import type { Post, Transcript } from "@shorts-studio/domain/post";
import { Effect, Layer } from "effect";
import { onTestFinished } from "vitest";
import type { Context, KeySpec } from "./context.ts";
import {
	type Check,
	Downloader,
	ImageMaker,
	type ImageRequest,
	MediaTools,
	type Ports,
	Transcriber,
	type VideoJob,
} from "./ports.ts";
import { createPost, updatePost } from "./post-store.ts";

/** The time every test context reads: 2026-11-04, 09:00 UTC. */
export const NOW = new Date("2026-11-04T09:00:00Z");

/** A new empty folder, removed when the test finishes. */
export const tempDir = (): string => {
	// realpath: macOS hands out /var/… paths that are really /private/var/….
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "shorts-studio-test-")));
	onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
	return dir;
};

/** A Context in a temporary folder. No API key is set unless `secrets` names its variable. */
export const testContext = (
	overrides: Partial<Context> & { readonly secrets?: Readonly<Record<string, string>> } = {},
): Context => {
	const root = tempDir();
	const { secrets = {}, ...rest } = overrides;
	return {
		paths: { data: join(root, "data"), posts: join(root, "posts") },
		config: {},
		brand: {},
		settingsIssues: [],
		secret: async (key) => secrets[key.env],
		now: () => NOW,
		log: () => {},
		...rest,
	};
};

// --- Fake ports -------------------------------------------------------------------------------

export type FakeImageMaker = ImageMaker["Service"] & {
	/** Every paid request, in the order it was sent. */
	readonly submits: Array<{
		readonly model: string;
		readonly prompt: string;
		readonly seed: number;
	}>;
	/**
	 * How `collect` answers, read on every call: with the image; never, so a run can be
	 * interrupted while it waits; or by ending the request, as a provider that gave up would.
	 */
	answer: "image" | "never" | "ended";
	/** How many `collect` calls were left waiting because `answer` was "never". */
	waits: number;
};

/** The bytes the fake returns for a request: they change with the prompt and the seed. */
export const fakeImageBytes = (prompt: string, seed: number): Uint8Array =>
	new TextEncoder().encode(`${prompt} #${seed}`);

/** An image provider in memory. It only collects requests it was sent. */
export const fakeImageMaker = (
	options: { readonly keys?: ReadonlyArray<KeySpec> } = {},
): FakeImageMaker => {
	const maker: FakeImageMaker = {
		provider: "fake-images",
		keys: options.keys ?? [],
		checks: Effect.succeed([]),
		models: ["fake-fast", "fake-fine"],
		defaultModel: "fake-fast",
		estimateUsd: (model) => (model === "fake-fine" ? 0.05 : 0.01),
		submits: [],
		answer: "image",
		waits: 0,
		submit: (model, prompt, seed) =>
			Effect.sync((): ImageRequest => {
				maker.submits.push({ model, prompt, seed });
				const requestId = `req-${maker.submits.length}`;
				return {
					requestId,
					statusUrl: `memory://${requestId}/status`,
					responseUrl: `memory://${requestId}`,
				};
			}),
		collect: (request) =>
			Effect.suspend(() => {
				const sent = maker.submits[Number(request.requestId.slice("req-".length)) - 1];
				if (sent === undefined) {
					return Effect.fail(fail("provider", `No request ${request.requestId}.`, "Submit it."));
				}
				switch (maker.answer) {
					case "never":
						maker.waits++;
						return Effect.never;
					case "ended":
						return Effect.fail(
							failBecause(
								new RequestEnded({
									message: `Request ${request.requestId} failed.`,
									fix: "Submit a new request.",
								}),
							),
						);
					case "image":
						return Effect.succeed(fakeImageBytes(sent.prompt, sent.seed));
				}
			}),
	};
	return maker;
};

export type FakeMediaTools = MediaTools["Service"] & {
	/** Every video asked for, in order. */
	readonly renders: Array<VideoJob>;
};

/**
 * Media tools in memory: every file is `durationSec` long, audio is copied rather than
 * converted, and a rendered video is a small text file describing the job.
 */
export const fakeMediaTools = (
	options: { readonly durationSec?: number; readonly checks?: ReadonlyArray<Check> } = {},
): FakeMediaTools => {
	const copy = (from: string, to: string) =>
		Effect.sync(() => {
			mkdirSync(dirname(to), { recursive: true });
			copyFileSync(from, to);
		});
	const media: FakeMediaTools = {
		provider: "fake-media",
		keys: [],
		checks: Effect.succeed(options.checks ?? []),
		rendererVersion: 1,
		renders: [],
		duration: () => Effect.succeed(options.durationSec ?? 4),
		extractAudio: copy,
		copyAudio: (cwd, input, output) => copy(join(cwd, input), join(cwd, output)),
		renderVideo: (job) =>
			Effect.sync(() => {
				media.renders.push(job);
				const file = join(job.cwd, job.output);
				mkdirSync(dirname(file), { recursive: true });
				writeFileSync(file, JSON.stringify(job.beats));
			}),
	};
	return media;
};

/** A transcriber in memory that hears `transcript` in every file. */
export const fakeTranscriber = (
	transcript: Transcript = {
		language: "en",
		text: "Hello there.",
		words: [
			{ text: "Hello", start: 0, end: 0.4 },
			{ text: "there.", start: 0.5, end: 0.9 },
		],
	},
): Transcriber["Service"] => ({
	provider: "fake-transcriber",
	keys: [],
	checks: Effect.succeed([]),
	model: "fake-whisper",
	transcribe: () => Effect.succeed(transcript),
});

/** A downloader in memory that reports every download as done. */
export const fakeDownloader = (): Downloader["Service"] => ({
	provider: "fake-downloader",
	keys: [],
	checks: Effect.succeed([]),
	downloadList: () => Effect.succeed({ ok: true, errors: "" }),
	downloadOne: () => Effect.succeed({ ok: true, errors: "" }),
});

/** Every port, each an in-memory fake unless replaced. */
export const fakePorts = (
	services: {
		readonly transcriber?: Transcriber["Service"];
		readonly imageMaker?: ImageMaker["Service"];
		readonly mediaTools?: MediaTools["Service"];
		readonly downloader?: Downloader["Service"];
	} = {},
): Layer.Layer<Ports> =>
	Layer.mergeAll(
		Layer.succeed(Transcriber, services.transcriber ?? fakeTranscriber()),
		Layer.succeed(ImageMaker, services.imageMaker ?? fakeImageMaker()),
		Layer.succeed(MediaTools, services.mediaTools ?? fakeMediaTools()),
		Layer.succeed(Downloader, services.downloader ?? fakeDownloader()),
	);

/** Runs a use case with the given ports (in-memory fakes by default). */
export const run = <A, E>(
	effect: Effect.Effect<A, E, Ports>,
	ports: Layer.Layer<Ports> = fakePorts(),
): Promise<A> => Effect.runPromise(effect.pipe(Effect.provide(ports)));

/** Runs a use case that should fail and returns its error; rejects if it succeeds. */
export const runFailure = <A, E>(
	effect: Effect.Effect<A, E, Ports>,
	ports: Layer.Layer<Ports> = fakePorts(),
): Promise<E> => Effect.runPromise(Effect.flip(effect).pipe(Effect.provide(ports)));

// --- Seeded posts -----------------------------------------------------------------------------

export type PostFields = Partial<Omit<Post, "slug" | "manifestVersion" | "revision">>;

/** Creates a post with these fields, as if the commands that record them had already run. */
export const seedPost = (ctx: Context, slug: string, fields: PostFields = {}): Promise<Post> =>
	Effect.runPromise(
		createPost(ctx, { slug, createdAt: NOW.toISOString() }).pipe(
			Effect.andThen(
				updatePost(ctx, slug, "test", (post) => Effect.succeed({ ...post, ...fields })),
			),
		),
	);

/** An approved script and two beats with prompts and no images: ready for `image generate`. */
export const readyForImages = (): PostFields => ({
	script: { file: "script.md", hash: "s", approvedHash: "s" },
	beats: {
		inputHash: "b",
		items: [
			{ index: 0, start: 0, end: 2, text: "one", prompt: "a red door" },
			{ index: 1, start: 2, end: 4, text: "two", prompt: "a blue sky" },
		],
	},
});

const generatedImage = (index: number) => ({
	file: `images/beat-0${index}.jpg`,
	hash: `i${index}`,
	inputHash: `h${index}`,
	provider: "fake-images",
	model: "fake-fast",
	seed: 1,
	source: "generated" as const,
});

/** Your own speech audio, two beats with images and a rendered draft waiting for review. */
export const withDraft = (draftHash = "d1"): PostFields => ({
	script: { file: "script.md", hash: "s", approvedHash: "s" },
	audio: {
		file: "audio/audio.m4a",
		hash: "a",
		origin: "mine",
		kind: "speech",
		durationSec: 4,
		source: "recording.m4a",
	},
	beats: {
		inputHash: "b",
		items: [
			{ index: 0, start: 0, end: 2, text: "one", prompt: "a door", image: generatedImage(0) },
			{ index: 1, start: 2, end: 4, text: "two", prompt: "a sky", image: generatedImage(1) },
		],
	},
	draft: { file: "draft.mp4", hash: draftHash, inputHash: "x", rendererVersion: 1, durationSec: 4 },
});
