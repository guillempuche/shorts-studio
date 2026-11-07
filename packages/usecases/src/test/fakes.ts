/**
 * In-memory fakes of every port, and helpers that run a use case with them, so it runs without
 * keys, ffmpeg or the network. The contracts in this folder check the fakes behave like the real
 * providers.
 */

import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fail, failBecause, Refused, RequestEnded } from "@shorts-studio/domain/errors";
import type { Model } from "@shorts-studio/domain/models";
import type { Transcript } from "@shorts-studio/domain/post";
import { Effect, Layer } from "effect";
import type { KeySpec } from "../context.ts";
import {
	type Check,
	Downloader,
	ImageMaker,
	type ImageRequest,
	MediaTools,
	type Ports,
	Transcriber,
	type VideoJob,
} from "../ports.ts";

export type FakeImageMaker = ImageMaker["Service"] & {
	/** Every paid request, in the order it was sent. */
	readonly submits: Array<{
		readonly endpoint: string;
		readonly prompt: string;
		readonly seed: number;
	}>;
	/**
	 * How the fake answers, read on every call. `collect` answers with the image; never, so a run
	 * can be interrupted while it waits; or by ending the request, as a provider that gave up
	 * would. `submit` fails when refused (an HTTP 4xx) or dropped (no answer, outcome unknown).
	 * When held, it waits for `letGo()`, so a run can be interrupted mid-send.
	 */
	answer: "image" | "never" | "ended" | "refused" | "dropped" | "held";
	/** How many `collect` calls were left waiting because `answer` was "never". */
	waits: number;
	/** How many `submit` calls are waiting for `letGo()` because `answer` was "held". */
	held: number;
	/** Lets held submits answer, as a provider does after a slow reply. */
	letGo: () => void;
};

/** How a fake fails a paid request: refused (a 4xx, nothing billed) or dropped (unknown). */
const paidCallFailure = (answer: "refused" | "dropped") =>
	answer === "refused"
		? failBecause(new Refused({ message: "The fake said no (HTTP 400).", fix: "Fix the request." }))
		: fail("provider", "The connection dropped before the fake answered.", "Run it again.");

/** The bytes the fake returns for a request: they change with the prompt and the seed. */
export const fakeImageBytes = (prompt: string, seed: number): Uint8Array =>
	new TextEncoder().encode(`${prompt} #${seed}`);

/** The fake's own image models, priced per image so a test's estimate is easy to read. */
export const FAKE_IMAGE_MODELS = {
	"fake-fast": {
		provider: "fake-images",
		job: "image",
		endpoint: "fake/fast",
		billedBy: "image",
		usdPerUnit: 0.01,
		priceChecked: "2026-11-01",
	},
	"fake-fine": {
		provider: "fake-images",
		job: "image",
		endpoint: "fake/fine",
		billedBy: "image",
		usdPerUnit: 0.05,
		priceChecked: "2026-11-01",
	},
} satisfies Record<string, Model>;

/** An image provider in memory. It only collects requests it was sent. */
export const fakeImageMaker = (
	options: { readonly keys?: ReadonlyArray<KeySpec> } = {},
): FakeImageMaker => {
	let open = () => {};
	const gate = new Promise<void>((resolve) => {
		open = resolve;
	});
	const maker: FakeImageMaker = {
		provider: "fake-images",
		keys: options.keys ?? [],
		checks: Effect.succeed([]),
		models: FAKE_IMAGE_MODELS,
		defaultModel: "fake-fast",
		submits: [],
		answer: "image",
		waits: 0,
		held: 0,
		letGo: () => open(),
		submit: (model, prompt, seed) =>
			Effect.suspend(() => {
				maker.submits.push({ endpoint: model.endpoint, prompt, seed });
				if (maker.answer === "refused" || maker.answer === "dropped") {
					return Effect.fail(paidCallFailure(maker.answer));
				}
				const requestId = `req-${maker.submits.length}`;
				const request: ImageRequest = {
					requestId,
					statusUrl: `memory://${requestId}/status`,
					responseUrl: `memory://${requestId}`,
				};
				if (maker.answer === "held") {
					maker.held++;
					return Effect.promise(() => gate).pipe(Effect.as(request));
				}
				return Effect.succeed(request);
			}),
		collect: (request) =>
			Effect.suspend(() => {
				const requestNumber = Number(request.requestId.slice("req-".length));
				const sent = maker.submits[requestNumber - 1];
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
					default:
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
 * Media tools in memory: every file is `durationSec` long (4 s unless set), audio is copied
 * rather than converted, and a rendered video is a small JSON file of the job's beats.
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

export type FakeTranscriber = Transcriber["Service"] & {
	/** Every file sent, in order, with the endpoint of the model it was sent to. */
	readonly calls: Array<{ readonly endpoint: string; readonly file: string }>;
};

/**
 * A transcriber in memory that hears `transcript` in every file, unless `answer` says it refuses
 * every file (an HTTP 4xx) or drops the connection (outcome unknown).
 */
export const fakeTranscriber = (
	transcript: Transcript = {
		language: "en",
		text: "Hello there.",
		words: [
			{ text: "Hello", start: 0, end: 0.4 },
			{ text: "there.", start: 0.5, end: 0.9 },
		],
	},
	options: {
		readonly answer?: "words" | "refused" | "dropped";
		readonly keys?: ReadonlyArray<KeySpec>;
	} = {},
): FakeTranscriber => {
	const transcriber: FakeTranscriber = {
		provider: "fake-transcriber",
		keys: options.keys ?? [],
		checks: Effect.succeed([]),
		models: {
			"fake-whisper": {
				provider: "fake-transcriber",
				job: "transcribe",
				endpoint: "fake/whisper",
				billedBy: "minute",
				usdPerUnit: 0.006,
				priceChecked: "2026-11-01",
			},
		},
		defaultModel: "fake-whisper",
		calls: [],
		transcribe: (model, file) =>
			Effect.suspend(() => {
				transcriber.calls.push({ endpoint: model.endpoint, file });
				const answer = options.answer ?? "words";
				return answer === "words"
					? Effect.succeed(transcript)
					: Effect.fail(paidCallFailure(answer));
			}),
	};
	return transcriber;
};

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
