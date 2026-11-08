/**
 * What every use case receives besides its ports: where files live, the user's settings, API
 * keys, the clock and the log. Plain values only; outside services and tools are ports
 * (ports.ts), so a fork swaps a provider without touching a use case.
 */

import { ModelSettings } from "@shorts-studio/domain/models";
import { type DateTime, type Redacted, Schema } from "effect";

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

export const DEFAULT_CAPS = { dailyUsd: 5, monthlyUsd: 100, postUsd: 2 } as const;

/** A spending cap: $0 or more. */
const Cap = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0));

/** config.json: providers, limits and tools. Every value can be overridden by `SHORTS_<PATH>`. */
export const Config = Schema.Struct({
	$schema: SchemaLink,
	caps: setting(
		Schema.Struct({
			dailyUsd: setting(
				Cap,
				`Most spent on paid calls in one day, in US dollars. Default ${DEFAULT_CAPS.dailyUsd}.`,
			),
			monthlyUsd: setting(
				Cap,
				`Most spent on paid calls in one calendar month, in US dollars. Default ${DEFAULT_CAPS.monthlyUsd}.`,
			),
			postUsd: setting(
				Cap,
				`Most spent on one post, in US dollars. Default ${DEFAULT_CAPS.postUsd}.`,
			),
		}),
		"Spending limits, checked before every paid call. Days and months follow the machine's time zone.",
	),
	transcribe: setting(ProviderChoice("transcribes audio"), "Transcription with word timings."),
	image: setting(ProviderChoice("makes the images"), "One image per beat."),
	models: setting(
		Schema.Record(Schema.String, ModelSettings),
		"Models by name: a new one with every field, or a provider's own one with only what changes, such as its price.",
	),
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

/** Where an API key is looked up: an environment variable, then a macOS Keychain entry. */
export interface KeySpec {
	readonly env: string;
	readonly keychain: string;
}

export interface Context {
	readonly paths: Paths;
	readonly config: Config;
	readonly brand: Brand;
	/**
	 * Why a setting couldn't be used: config.json, brand.json or a SHORTS_* variable. Its default
	 * applies, and doctor reports it as a problem to fix.
	 */
	readonly settingsIssues: ReadonlyArray<string>;
	/** Settings that fell back to a default without stopping anything, such as TZ. Doctor warns. */
	readonly settingsWarnings: ReadonlyArray<string>;
	/** An API key, or undefined when it isn't set. Redacted, so printing it shows `<redacted>`. */
	readonly secret: (key: KeySpec) => Promise<Redacted.Redacted<string> | undefined>;
	readonly now: () => Date;
	/** The machine's time zone, which sets where a day and a month start for the caps. */
	readonly timeZone: DateTime.TimeZone;
	/**
	 * A person is at the terminal: stdin is one. An agent's shell and an MCP server have none,
	 * so the user's own decisions check it.
	 */
	readonly interactive: boolean;
	/** Progress and diagnostics: always stderr, since stdout carries results and MCP messages. */
	readonly log: (line: string) => void;
}
