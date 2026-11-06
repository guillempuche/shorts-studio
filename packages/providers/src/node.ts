/**
 * The Node side of `Context`: folders from the environment, settings files, API keys from the
 * environment or the macOS Keychain, and what providers need to reach the outside world.
 */

import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Brand, Config, type Context, type Paths } from "@shorts-studio/usecases/context";
import { Result, Schema } from "effect";
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
		config: readSettings(join(paths.data, "config.json"), Config, settingsIssues) ?? {},
		brand: readSettings(join(paths.data, "brand.json"), Brand, settingsIssues) ?? {},
		settingsIssues,
		secret: async (key) => env[key.env] || (await keychain(key.keychain)),
		run: runProcess,
		now: () => new Date(),
		log: (line) => process.stderr.write(`${line}\n`),
	};
};
