/**
 * What every use case receives besides its ports: where files live, the user's settings, API
 * keys, the clock and the log. Plain values only; outside services and tools are ports
 * (ports.ts), so a fork swaps a provider without touching a use case.
 */

import { Schema } from "effect";

export interface Paths {
	/** brand.json, config.json and the spend ledger. */
	readonly data: string;
	/** Post folders (`mine/`) and saved collections (`saved/`). */
	readonly posts: string;
}

/** Which provider does a job, and with which model. Unset: the provider's own default. */
const ProviderChoice = Schema.Struct({
	provider: Schema.optionalKey(Schema.String),
	model: Schema.optionalKey(Schema.String),
});

export const Config = Schema.Struct({
	caps: Schema.optionalKey(
		Schema.Struct({
			dailyUsd: Schema.optionalKey(Schema.Finite),
			postUsd: Schema.optionalKey(Schema.Finite),
		}),
	),
	transcribe: Schema.optionalKey(ProviderChoice),
	image: Schema.optionalKey(ProviderChoice),
	download: Schema.optionalKey(
		Schema.Struct({
			/** Browser whose session yt-dlp reuses (Instagram needs a login), e.g. chrome. Opt-in. */
			cookiesFromBrowser: Schema.optionalKey(Schema.String),
		}),
	),
	captions: Schema.optionalKey(
		Schema.Struct({
			font: Schema.optionalKey(Schema.String),
			fontsDir: Schema.optionalKey(Schema.String),
			fontSize: Schema.optionalKey(Schema.Finite),
			/** Colour each word as it's spoken; off by default (docs/research/captions.md). */
			highlight: Schema.optionalKey(Schema.Boolean),
		}),
	),
});
export type Config = typeof Config.Type;

export const Brand = Schema.Struct({
	imagePrompt: Schema.optionalKey(
		Schema.Struct({
			suffix: Schema.optionalKey(Schema.String),
		}),
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
	/** An API key, or undefined when it isn't set. Never logged. */
	readonly secret: (key: KeySpec) => Promise<string | undefined>;
	readonly now: () => Date;
	/** Progress and diagnostics: always stderr, since stdout carries results and MCP messages. */
	readonly log: (line: string) => void;
}
