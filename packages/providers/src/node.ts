/**
 * The Node side of `Context`: folders from the environment, settings files, API keys from the
 * environment or the macOS Keychain, and what providers need to reach the outside world.
 */

import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	Brand,
	type Context,
	type Paths,
	Config as Settings,
} from "@shorts-studio/usecases/context";
import { Config, ConfigProvider, Effect, Redacted, Result, Schema } from "effect";
import { type RunResult, runProcess } from "./process.ts";

/** Base URLs of the paid services, by provider. Tests and local fakes override them. */
export type Endpoints = Readonly<Record<string, string>>;

/** A `Context` plus what providers use to reach the outside world. */
export interface ProviderContext extends Context {
	readonly endpoints: Endpoints;
	/** Runs an external program (ffmpeg, ffprobe, yt-dlp); stops it when `signal` aborts. */
	readonly run: (
		file: string,
		args: ReadonlyArray<string>,
		options?: { readonly signal?: AbortSignal; readonly cwd?: string },
	) => Promise<RunResult>;
}

/** The OS's per-user application data folder. */
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
 * A settings file with its `SHORTS_…` environment overrides, checked against its Schema. Each
 * value comes from the environment if set there, then from the file, then the built-in default:
 * `SHORTS_IMAGE_MODEL=flux-dev` replaces only `image.model` from config.json. Undefined when the
 * result is invalid; the reason goes to `issues`.
 */
const readSettings = <S extends Schema.Codec<unknown, unknown>>(
	file: string,
	schema: S,
	envPrefix: ReadonlyArray<string>,
	env: NodeJS.ProcessEnv,
	issues: Array<string>,
): S["Type"] | undefined => {
	const where = `${file} or a ${envPrefix.join("_")}_* variable`;
	let saved: unknown = {};
	if (existsSync(file)) {
		const parsed = Schema.decodeUnknownResult(Schema.fromJsonString(Schema.Unknown))(
			readFileSync(file, "utf8"),
		);
		if (Result.isFailure(parsed)) {
			issues.push(`${file}: ${parsed.failure.message.replace(/\s*\n\s*/g, " ")}`);
			return undefined;
		}
		saved = parsed.success;
	}
	const fromEnv = ConfigProvider.fromEnv({ env: definedOnly(env) }).pipe(
		ConfigProvider.mapInput((path) => path.flatMap(envWords)),
		ConfigProvider.nested(envPrefix),
	);
	const provider = fromEnv.pipe(ConfigProvider.orElse(ConfigProvider.fromUnknown(saved)));
	const result = Effect.runSync(Effect.result(Config.schema(schema).parse(provider)));
	if (Result.isSuccess(result)) return result.success;
	issues.push(
		`${where}: ${result.failure.message.replace(/^SchemaError\((.*)\)$/s, "$1").replace(/\s*\n\s*/g, " ")}`,
	);
	return undefined;
};

/**
 * A setting's name as the words of its environment variable: `imagePrompt` → `IMAGE`, `PROMPT`.
 * The environment is looked up one `_`-separated word at a time, so each word is its own step.
 */
const envWords = (segment: string | number): ReadonlyArray<string | number> =>
	typeof segment === "number"
		? [segment]
		: segment
				.replace(/([a-z0-9])([A-Z])/g, "$1_$2")
				.toUpperCase()
				.split("_");

const definedOnly = (env: NodeJS.ProcessEnv): Record<string, string> =>
	Object.fromEntries(
		Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined),
	);

/**
 * Providers' base URLs from the environment, overridden for tests and fakes:
 * `SHORTS_FAL_URL` → `fal`, `SHORTS_FISH_AUDIO_URL` → `fish-audio` (provider names are kebab-case).
 */
const endpointsFrom = (env: NodeJS.ProcessEnv): Endpoints =>
	Object.fromEntries(
		Object.entries(env).flatMap(([name, value]) => {
			const provider = /^SHORTS_([A-Z0-9]+(?:_[A-Z0-9]+)*)_URL$/.exec(name)?.[1];
			return provider === undefined || !value
				? []
				: [[provider.toLowerCase().replaceAll("_", "-"), value]];
		}),
	);

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

export const makeContext = (env: NodeJS.ProcessEnv = process.env): ProviderContext => {
	const paths = resolvePaths(env);
	const settingsIssues: Array<string> = [];
	return {
		paths,
		endpoints: endpointsFrom(env),
		config:
			readSettings(join(paths.data, "config.json"), Settings, ["SHORTS"], env, settingsIssues) ??
			{},
		brand:
			readSettings(
				join(paths.data, "brand.json"),
				Brand,
				["SHORTS", "BRAND"],
				env,
				settingsIssues,
			) ?? {},
		settingsIssues,
		secret: async (key) => {
			const value = env[key.env] || (await keychain(key.keychain));
			return value === undefined ? undefined : Redacted.make(value);
		},
		run: runProcess,
		now: () => new Date(),
		interactive: process.stdin.isTTY === true,
		log: (line) => process.stderr.write(`${line}\n`),
	};
};
