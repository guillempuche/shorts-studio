/**
 * What every operation receives: where files live, how to reach the outside world, and the
 * user's settings.
 *
 * It's a plain object, not a set of Effect services, on purpose. Operations are plain functions
 * that take it, so a test swaps `fetch`, `run` or the folders for fakes by building a different
 * object. We use Effect where it helps (interruption, the CLI, the MCP server), not to pass
 * arguments around.
 */

import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Result, Schema } from "effect";
import { type RunResult, runProcess } from "./process.ts";

export interface Paths {
	/** brand.json, config.json and the spend ledger. */
	readonly data: string;
	/** Post folders (`mine/`) and saved collections (`saved/`). */
	readonly posts: string;
}

/** The FAL image models `image generate` knows; see `IMAGE_MODELS` in src/work/fal.ts. */
export const ImageModelName = Schema.Literals(["flux-schnell", "flux-dev"]);
export type ImageModelName = typeof ImageModelName.Type;

export const Config = Schema.Struct({
	caps: Schema.optionalKey(
		Schema.Struct({
			dailyUsd: Schema.optionalKey(Schema.Finite),
			postUsd: Schema.optionalKey(Schema.Finite),
		}),
	),
	image: Schema.optionalKey(
		Schema.Struct({
			model: Schema.optionalKey(ImageModelName),
		}),
	),
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

/** Base URLs of the paid services. Tests and local fakes override them. */
export interface Endpoints {
	readonly fal: string;
	readonly together: string;
}

export interface Context {
	readonly paths: Paths;
	readonly endpoints: Endpoints;
	readonly config: Config;
	readonly brand: Brand;
	/** Why config.json or brand.json couldn't be read. Defaults apply, and doctor reports it. */
	readonly settingsIssues: ReadonlyArray<string>;
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
	/** Progress and diagnostics: always stderr, since stdout carries results and MCP messages. */
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

/**
 * A settings file's contents. Undefined when the file is missing or invalid; the reason it's
 * invalid goes to `issues`.
 */
const readSettings = <S extends Schema.Codec<unknown, unknown>>(
	file: string,
	schema: S,
	issues: Array<string>,
): S["Type"] | undefined => {
	if (!existsSync(file)) return undefined;
	const result = Schema.decodeUnknownResult(Schema.fromJsonString(schema))(
		readFileSync(file, "utf8"),
	);
	if (Result.isSuccess(result)) return result.success;
	issues.push(`${file}: ${result.failure.message.replace(/\s*\n\s*/g, " ")}`);
	return undefined;
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
	const settingsIssues: Array<string> = [];
	return {
		paths,
		endpoints: {
			fal: env["SHORTS_FAL_URL"] || "https://queue.fal.run",
			together: env["SHORTS_TOGETHER_URL"] || "https://api.together.ai",
		},
		config: readSettings(join(paths.data, "config.json"), Config, settingsIssues) ?? {},
		brand: readSettings(join(paths.data, "brand.json"), Brand, settingsIssues) ?? {},
		settingsIssues,
		secret: async (name) => env[name] || (await keychain(SECRETS[name])),
		fetch: globalThis.fetch,
		run: runProcess,
		now: () => new Date(),
		log: (line) => process.stderr.write(`${line}\n`),
	};
};
