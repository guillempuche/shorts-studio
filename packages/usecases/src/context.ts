/**
 * What every use case receives besides its ports: where files live, the user's settings, API
 * keys, the clock and the log. Plain values only; outside services and tools are ports
 * (ports.ts), so a fork swaps a provider without touching a use case.
 */

import { type Redacted, Schema } from "effect";

export interface Paths {
	/** brand.json, config.json and the spend ledger. */
	readonly data: string;
	/** Post folders (`mine/`) and saved collections (`saved/`). */
	readonly posts: string;
}

/** An optional setting with the description editors show (it's in the published JSON Schema). */
const setting = <S extends Schema.Top>(schema: S, description: string) =>
	Schema.optionalKey(schema.annotate({ description }));

/** Which provider does a job, and with which model. Unset: the provider's own default. */
const ProviderChoice = (job: string) =>
	Schema.Struct({
		provider: setting(Schema.String, `The provider that ${job}, e.g. "fal". Unset: the default.`),
		model: setting(Schema.String, "One of the provider's models. Unset: the provider's default."),
	});

const SchemaLink = setting(
	Schema.String,
	"Where the JSON Schema for this file is, so an editor can complete and check it.",
);

/** config.json: providers, limits and tools. Every value can be overridden by `SHORTS_<PATH>`. */
export const Config = Schema.Struct({
	$schema: SchemaLink,
	caps: setting(
		Schema.Struct({
			dailyUsd: setting(
				Schema.Finite,
				"Most spent on paid calls in one day, in US dollars. Default 5.",
			),
			postUsd: setting(Schema.Finite, "Most spent on one post, in US dollars. Default 2."),
		}),
		"Spending limits, checked before every paid call.",
	),
	transcribe: setting(ProviderChoice("transcribes audio"), "Transcription with word timings."),
	image: setting(ProviderChoice("makes the images"), "One image per beat."),
	download: setting(
		Schema.Struct({
			cookiesFromBrowser: setting(
				Schema.String,
				"Browser whose login yt-dlp reuses, e.g. chrome. Instagram needs one. Unset: none.",
			),
		}),
		"Downloading saved reels and TikToks.",
	),
	captions: setting(
		Schema.Struct({
			font: setting(Schema.String, 'Font family for burned-in captions. Default "Arial".'),
			fontsDir: setting(Schema.String, "Folder with the font files, if it isn't installed."),
			fontSize: setting(Schema.Finite, "Caption size in pixels on the 1080×1920 frame."),
			highlight: setting(
				Schema.Boolean,
				"Colour each word as it's spoken. Off by default (docs/research/captions.md).",
			),
		}),
		"How burned-in captions look.",
	),
});
export type Config = typeof Config.Type;

/** brand.json: the creative identity. Every value can be overridden by `SHORTS_BRAND_<PATH>`. */
export const Brand = Schema.Struct({
	$schema: SchemaLink,
	imagePrompt: setting(
		Schema.Struct({
			suffix: setting(
				Schema.String,
				'Style added to every image prompt, e.g. "soft film grain, muted colours".',
			),
		}),
		"How every image prompt ends.",
	),
});
export type Brand = typeof Brand.Type;

export const DEFAULT_CAPS = { dailyUsd: 5, postUsd: 2 } as const;

/** Where an API key is looked up: an environment variable, then a macOS Keychain entry. */
export interface KeySpec {
	readonly env: string;
	readonly keychain: string;
}

export interface Context {
	readonly paths: Paths;
	readonly config: Config;
	readonly brand: Brand;
	/** Why config.json or brand.json couldn't be read. Defaults apply, and doctor reports it. */
	readonly settingsIssues: ReadonlyArray<string>;
	/** An API key, or undefined when it isn't set. Redacted, so printing it shows `<redacted>`. */
	readonly secret: (key: KeySpec) => Promise<Redacted.Redacted<string> | undefined>;
	readonly now: () => Date;
	/** Progress and diagnostics: always stderr, since stdout carries results and MCP messages. */
	readonly log: (line: string) => void;
}
