/**
 * The jobs the use cases hand to the outside world. Each port is an Effect service; each
 * provider (FAL, Together, ffmpeg, yt-dlp, or one a fork adds) is a layer that implements one or
 * more of them. Settings choose the layer, so a use case never names a provider.
 */

import type { RenderBeat } from "@shorts-studio/domain/direction";
import type { ShortsError } from "@shorts-studio/domain/errors";
import type { Model } from "@shorts-studio/domain/models";
import type { Transcript } from "@shorts-studio/domain/post";
import { Context, type Effect } from "effect";
import type { KeySpec } from "./context.ts";

/** One row of `doctor`: a tool or key, whether it works, and how to fix it. */
export interface Check {
	readonly name: string;
	readonly status: "ok" | "warn" | "fail";
	readonly detail: string;
	readonly fix?: string;
}

/** What every provider says about itself, for records and for `doctor`. */
export interface ProviderInfo {
	readonly provider: string;
	/** The API keys it needs; `doctor` checks only the keys of providers in use. */
	readonly keys: ReadonlyArray<KeySpec>;
	/** Tool and connection checks for `doctor`, beyond the keys. */
	readonly checks: Effect.Effect<ReadonlyArray<Check>>;
}

/**
 * A paid provider's own models, by name. The use case picks one, merged with config.json's
 * `models`, and hands the whole model back, so a model added in config.json needs no code.
 */
export interface OwnModels {
	readonly models: Readonly<Record<string, Model>>;
	/** The model used when neither the command nor config.json names one. */
	readonly defaultModel: string;
}

export class Transcriber extends Context.Service<
	Transcriber,
	ProviderInfo &
		OwnModels & {
			/** Every word with its start and end. `language` undefined means detect it. */
			transcribe(
				model: Model,
				file: string,
				language: string | undefined,
			): Effect.Effect<Transcript, ShortsError>;
		}
>()("shorts-studio/Transcriber") {}

/** A paid image request, saved before waiting so a cut-short run picks it up again. */
export interface ImageRequest {
	readonly requestId: string;
	readonly statusUrl: string;
	readonly responseUrl: string;
}

export class ImageMaker extends Context.Service<
	ImageMaker,
	ProviderInfo &
		OwnModels & {
			submit(model: Model, prompt: string, seed: number): Effect.Effect<ImageRequest, ShortsError>;
			/** Waits for the image. Fails with reason `RequestEnded` when the provider gave up on it. */
			collect(request: ImageRequest): Effect.Effect<Uint8Array, ShortsError>;
		}
>()("shorts-studio/ImageMaker") {}

/** A video to render, with paths relative to `cwd` (the post folder). */
export interface VideoJob {
	readonly cwd: string;
	readonly beats: ReadonlyArray<RenderBeat>;
	/** Undefined: a silent video. */
	readonly audio: string | undefined;
	/** An ASS file to burn in; undefined: no captions. */
	readonly captions: string | undefined;
	readonly output: string;
}

export class MediaTools extends Context.Service<
	MediaTools,
	ProviderInfo & {
		/** Part of every draft's input hash: a new renderer makes old drafts out of date. */
		readonly rendererVersion: number;
		duration(file: string): Effect.Effect<number, ShortsError>;
		/** Converts any audio or video file to AAC audio in an .m4a file. Takes absolute paths. */
		extractAudio(input: string, output: string): Effect.Effect<void, ShortsError>;
		renderVideo(job: VideoJob): Effect.Effect<void, ShortsError>;
		copyAudio(cwd: string, input: string, output: string): Effect.Effect<void, ShortsError>;
	}
>()("shorts-studio/MediaTools") {}

/** What a download run reports: whether everything came down, and the errors it printed. */
export interface DownloadResult {
	readonly ok: boolean;
	readonly errors: string;
}

export class Downloader extends Context.Service<
	Downloader,
	ProviderInfo & {
		/** The audio of every URL in `urlsFile` not yet listed in `archiveFile`, into `output`. */
		downloadList(job: {
			readonly cwd: string;
			readonly urlsFile: string;
			readonly archiveFile: string;
			readonly output: string;
		}): Effect.Effect<DownloadResult, ShortsError>;
		/** The audio of one post, into `output` (relative to `cwd`). */
		downloadOne(job: {
			readonly cwd: string;
			readonly url: string;
			readonly output: string;
		}): Effect.Effect<DownloadResult, ShortsError>;
	}
>()("shorts-studio/Downloader") {}

/** Every port a use case may ask for. The CLI, MCP server and tests provide all of them. */
export type Ports = Transcriber | ImageMaker | MediaTools | Downloader;
