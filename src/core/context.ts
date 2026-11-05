/**
 * What every operation is handed: where things live, how to reach the outside world, and the
 * user's settings.
 *
 * A plain object rather than Effect services, on purpose: operations are plain functions over
 * this, so a test swaps `fetch`, `run` or the folders for fakes by building a different object.
 * Effect is used where it earns its place (interruption, the CLI and MCP surfaces), not as the
 * way to pass arguments.
 */

import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Schema } from "effect";
import { type RunResult, runProcess } from "./process.ts";

export interface Paths {
	/** brand.json, config.json and the spend ledger. */
	readonly data: string;
	/** Post folders (`mine/`) and saved collections (`saved/`). */
	readonly posts: string;
}

export const Config = Schema.Struct({
	caps: Schema.optionalKey(
		Schema.Struct({
			dailyUsd: Schema.optionalKey(Schema.Finite),
			postUsd: Schema.optionalKey(Schema.Finite),
		}),
	),
	image: Schema.optionalKey(
		Schema.Struct({
			model: Schema.optionalKey(Schema.String),
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

/** Provider base URLs; overridable so tests and local fakes stand in for the real services. */
export interface Endpoints {
	readonly fal: string;
	readonly together: string;
}

export interface Context {
	readonly paths: Paths;
	readonly endpoints: Endpoints;
	readonly config: Config;
	readonly brand: Brand;
	/** An API key from the environment, or on macOS from the Keychain. Never logged. */
	readonly secret: (name: SecretName) => Promise<string | undefined>;
	readonly fetch: typeof globalThis.fetch;
	/** Runs an external program (ffmpeg, ffprobe); stops it when `signal` aborts. */
	readonly run: (
		file: string,
		args: ReadonlyArray<string>,
		options?: { readonly signal?: AbortSignal; readonly cwd?: string },
	) => Promise<RunResult>;
	readonly now: () => Date;
	/** Progress and diagnostics: always stderr, never stdout (stdout carries results and MCP). */
	readonly log: (line: string) => void;
}

export const SECRETS = {
	TOGETHER_API_KEY: "together-api-key",
	FAL_KEY: "fal-key",
	ELEVENLABS_API_KEY: "elevenlabs-api-key",
	FISH_API_KEY: "fish-audio-key",
} as const;
export type SecretName = keyof typeof SECRETS;

/** The OS's per-user application data folder, like content-studio's roots.ts. */
const appDataDir = (env: NodeJS.ProcessEnv): string => {
	if (process.platform === "darwin") return join(homedir(), "Library", "Application Support");
	if (process.platform === "win32") return env["APPDATA"] ?? join(homedir(), "AppData", "Roaming");
	return env["XDG_DATA_HOME"] ?? join(homedir(), ".local", "share");
};

export const resolvePaths = (env: NodeJS.ProcessEnv): Paths => {
	const data = env["SHORTS_DATA_DIR"] || join(appDataDir(env), "shorts-studio");
	return { data, posts: env["SHORTS_POSTS_DIR"] || join(data, "posts") };
};

const readJson = <S extends Schema.Codec<unknown, unknown>>(
	file: string,
	schema: S,
): S["Type"] | undefined => {
	if (!existsSync(file)) return undefined;
	return Schema.decodeUnknownSync(Schema.fromJsonString(schema))(readFileSync(file, "utf8"));
};

/** Reads a key from the macOS Keychain with `security`; undefined anywhere else or if absent. */
const keychain = (service: string): Promise<string | undefined> =>
	process.platform !== "darwin"
		? Promise.resolve(undefined)
		: new Promise((resolve) => {
				execFile(
					"security",
					["find-generic-password", "-a", process.env["USER"] ?? "", "-s", service, "-w"],
					(error, stdout) => resolve(error ? undefined : stdout.trim() || undefined),
				);
			});

export const makeContext = (env: NodeJS.ProcessEnv = process.env): Context => {
	const paths = resolvePaths(env);
	return {
		paths,
		endpoints: {
			fal: env["SHORTS_FAL_URL"] || "https://queue.fal.run",
			together: env["SHORTS_TOGETHER_URL"] || "https://api.together.ai",
		},
		config: readJson(join(paths.data, "config.json"), Config) ?? {},
		brand: readJson(join(paths.data, "brand.json"), Brand) ?? {},
		secret: async (name) => env[name] || (await keychain(SECRETS[name])),
		fetch: globalThis.fetch,
		run: runProcess,
		now: () => new Date(),
		log: (line) => process.stderr.write(`${line}\n`),
	};
};
