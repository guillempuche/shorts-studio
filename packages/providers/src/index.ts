/**
 * Which provider does each job, from the settings. A fork adds a provider by writing its layer
 * and adding one line to the list for each job it does.
 */

import { fail } from "@shorts-studio/domain/errors";
import { type Check, ImageMaker, type Ports, Transcriber } from "@shorts-studio/usecases/ports";
import { Effect, Layer } from "effect";
import type { HttpClient } from "effect/http";
import { ProviderEnv, withEnv } from "./env.ts";
import { falLayer } from "./fal.ts";
import { ffmpegLayer } from "./ffmpeg.ts";
import type { ProviderContext } from "./node.ts";
import { togetherLayer } from "./together.ts";
import { ytDlpLayer } from "./yt-dlp.ts";

type ProviderLayer<A> = Layer.Layer<A, never, ProviderEnv | HttpClient.HttpClient>;

const TRANSCRIBERS: Readonly<Record<string, ProviderLayer<Transcriber>>> = {
	together: togetherLayer,
};

const IMAGE_MAKERS: Readonly<Record<string, ProviderLayer<ImageMaker>>> = {
	fal: falLayer,
};

/** A provider the settings name but no layer offers: every call, and doctor, say how to fix it. */
const unknown = (job: string, name: string, known: Readonly<Record<string, unknown>>) => {
	const error = fail(
		"usage",
		`No ${job} provider is called "${name}".`,
		`Set ${job}.provider in config.json to one of: ${Object.keys(known).join(", ")}.`,
	);
	const check: Check = {
		name: `${job} provider`,
		status: "fail",
		detail: error.message,
		fix: error.fix,
	};
	return { provider: name, keys: [], checks: Effect.succeed([check]), fail: Effect.fail(error) };
};

const transcriberLayer = (name: string): ProviderLayer<Transcriber> => {
	const layer = TRANSCRIBERS[name];
	if (layer !== undefined) return layer;
	const stub = unknown("transcribe", name, TRANSCRIBERS);
	return Layer.succeed(Transcriber, {
		...stub,
		models: {},
		defaultModel: "",
		transcribe: () => stub.fail,
	});
};

const imageMakerLayer = (name: string): ProviderLayer<ImageMaker> => {
	const layer = IMAGE_MAKERS[name];
	if (layer !== undefined) return layer;
	const stub = unknown("image", name, IMAGE_MAKERS);
	return Layer.succeed(ImageMaker, {
		...stub,
		models: {},
		defaultModel: "",
		submit: () => stub.fail,
		collect: () => stub.fail,
	});
};

/** Every port, each from the provider the settings choose. */
const chosen = Layer.unwrap(
	Effect.gen(function* () {
		const env = yield* ProviderEnv;
		return Layer.mergeAll(
			transcriberLayer(env.config.transcribe?.provider ?? "together"),
			imageMakerLayer(env.config.image?.provider ?? "fal"),
			ffmpegLayer,
			ytDlpLayer,
		);
	}),
);

export const providersLayer = (ctx: ProviderContext): Layer.Layer<Ports> => withEnv(chosen, ctx);
