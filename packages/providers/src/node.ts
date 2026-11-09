/**
 * The Node side of `Context`: folders from the environment, settings files, API keys from the
 * environment or the macOS Keychain, and what providers need to reach the outside world.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { issueLine, schemaIssues } from "@shorts-studio/domain/errors";
import {
	Brand,
	type Context,
	type Paths,
	Config as Settings,
} from "@shorts-studio/usecases/context";
import { DateTime, Option, Redacted, Result, Schema, type SchemaAST } from "effect";
import { runProcess, tryRun } from "./process.ts";

/** Base URLs of the paid services, by provider. Tests and local fakes override them. */
export type Endpoints = Readonly<Record<string, string>>;

/** A `Context` plus what providers use to reach the outside world. */
export interface ProviderContext extends Context {
	readonly endpoints: Endpoints;
	/** Runs an external program (ffmpeg, ffprobe, yt-dlp); stops it when `signal` aborts. */
	readonly run: typeof runProcess;
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
 * `SHORTS_IMAGE_MODEL=flux-dev` replaces only `image.model` from config.json. A file that isn't
 * valid is left out, and why goes to `issues`; the environment's settings still apply.
 */
const readSettings = <S extends Schema.Codec<unknown, unknown>>(
	file: string,
	schema: S,
	envPrefix: string,
	env: NodeJS.ProcessEnv,
	issues: Array<string>,
): S["Type"] => {
	const decode = Schema.decodeUnknownResult(schema, { errors: "all" });
	const fromText = leafFromText(schema);
	const overrides = envOverrides(schema, fromText, envPrefix, env, issues);
	if (existsSync(file)) {
		const parsed = Schema.decodeUnknownResult(Schema.fromJsonString(Schema.Unknown))(
			readFileSync(file, "utf8"),
		);
		const result = Result.isSuccess(parsed)
			? decode(overlay(numbersFromText(schema, fromText, parsed.success), overrides))
			: parsed;
		if (Result.isSuccess(result)) return result.success;
		issues.push(`${file}: ${issueLine(result.failure)}`);
	}
	// Each override was checked on its own, so together they always decode.
	return Result.getOrElse(decode(overrides), () => ({}));
};

/**
 * The settings a `SHORTS_…` variable can set: every leaf of the file's Schema, by path. A
 * variable must name one exactly, so `SHORTS_CAPTIONS_FONT_SIZE` can't be read as a part of
 * `captions.font`. Records (`models`) are left out: their keys are names, which don't fit in a
 * variable's name.
 */
const settingPaths = (ast: SchemaAST.AST, path: ReadonlyArray<string> = []) => {
	// A group declared as optional-or-undefined is still a group: its settings are its leaves.
	if (ast._tag === "Union") {
		const defined = ast.types.filter((type) => type._tag !== "Undefined");
		if (defined.length === 1 && defined[0] !== undefined) return settingPaths(defined[0], path);
	}
	if (ast._tag !== "Objects") return [path];
	if (ast.indexSignatures.length > 0) return [];
	return ast.propertySignatures.flatMap(
		(property): Array<ReadonlyArray<string>> =>
			typeof property.name !== "string" || property.name.startsWith("$")
				? []
				: settingPaths(property.type, [...path, property.name]),
	);
};

/** `captions.fontSize` → `SHORTS_CAPTIONS_FONT_SIZE`. */
const envName = (prefix: string, path: ReadonlyArray<string>): string =>
	[prefix, ...path.map((key) => key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase())].join(
		"_",
	);

type LeafFromText = (
	path: ReadonlyArray<string>,
	text: string,
) => Result.Result<unknown, Schema.SchemaError>;

/** Decodes one setting from its text (`"7"` → 7), as a settings object holding only it. */
const leafFromText = <S extends Schema.Codec<unknown, unknown>>(schema: S): LeafFromText => {
	const decode = Schema.decodeUnknownResult(Schema.toCodecStringTree(schema));
	return (path, text) => {
		const one: Record<string, unknown> = {};
		setAt(one, path, text);
		return decode(one);
	};
};

/**
 * The settings the environment sets, each decoded from its text. One that isn't valid is left
 * out, and why goes to `issues`, naming its variable: the rest still apply.
 */
const envOverrides = <S extends Schema.Codec<unknown, unknown>>(
	schema: S,
	fromText: LeafFromText,
	prefix: string,
	env: NodeJS.ProcessEnv,
	issues: Array<string>,
): unknown => {
	let overrides: unknown = {};
	for (const path of settingPaths(schema.ast)) {
		const name = envName(prefix, path);
		const value = env[name];
		// An empty variable is unset, as most shells and tools treat it.
		if (!value) continue;
		const decoded = fromText(path, value);
		if (Result.isSuccess(decoded)) overrides = overlay(overrides, decoded.success);
		else
			issues.push(
				`${name}: ${schemaIssues(decoded.failure)
					.map((issue) => issue.message)
					.join("; ")}`,
			);
	}
	return overrides;
};

/**
 * The file's settings, with a number or yes/no written as text (`"dailyUsd": "1"`) read as the
 * value it names. Earlier versions accepted them, and refusing the whole file would put the
 * spending caps back to their defaults.
 */
const numbersFromText = <S extends Schema.Codec<unknown, unknown>>(
	schema: S,
	fromText: LeafFromText,
	saved: unknown,
): unknown => {
	let read = saved;
	for (const path of settingPaths(schema.ast)) {
		const value = getAt(saved, path);
		if (typeof value !== "string") continue;
		const decoded = fromText(path, value);
		if (Result.isSuccess(decoded)) read = overlay(read, decoded.success);
	}
	return read;
};

const getAt = (tree: unknown, path: ReadonlyArray<string>): unknown =>
	path.reduce<unknown>((node, key) => (isPlainObject(node) ? node[key] : undefined), tree);

const setAt = (tree: Record<string, unknown>, path: ReadonlyArray<string>, value: unknown) => {
	let node = tree;
	for (const key of path.slice(0, -1)) {
		node[key] ??= {};
		node = node[key] as Record<string, unknown>;
	}
	const last = path.at(-1);
	if (last !== undefined) node[last] = value;
};

/**
 * `top` over `base`, object by object, so a variable replaces one setting and keeps its siblings.
 */
const overlay = (base: unknown, top: unknown): unknown => {
	if (top === undefined) return base;
	if (base === undefined) return top;
	if (isPlainObject(base) && isPlainObject(top)) {
		const merged: Record<string, unknown> = { ...base };
		for (const [key, value] of Object.entries(top)) merged[key] = overlay(base[key], value);
		return merged;
	}
	// A setting replaces a value; a group of them doesn't replace a file value of the wrong type,
	// which stays so the Schema reports it.
	return isPlainObject(top) ? base : top;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

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
const keychain = async (env: NodeJS.ProcessEnv, service: string): Promise<string | undefined> => {
	if (process.platform !== "darwin") return undefined;
	const found = await tryRun({ run: runProcess }, "security", [
		"find-generic-password",
		"-a",
		env["USER"] ?? "",
		"-s",
		service,
		"-w",
	]);
	return found?.code === 0 ? found.stdout.trim() || undefined : undefined;
};

/**
 * The zone days and months follow: the one TZ names, else the machine's. TZ may start with a
 * colon (`:Europe/Madrid`), and Linux often points it at a file: `:/etc/localtime` is the
 * machine's own zone, and a path under `zoneinfo/` names one. A TZ that names no zone (a typo, or
 * a POSIX rule like UTC+3) falls back to UTC, and doctor warns.
 */
const timeZoneFrom = (env: NodeJS.ProcessEnv, warnings: Array<string>): DateTime.TimeZone => {
	const tz = env["TZ"];
	if (tz === undefined) return DateTime.zoneMakeLocal();
	const zoneOrPath = tz.startsWith(":") ? tz.slice(1) : tz;
	const name = zoneOrPath.startsWith("/") ? zoneOrPath.split("/zoneinfo/")[1] : zoneOrPath;
	if (name === undefined) return DateTime.zoneMakeLocal();
	const named = DateTime.zoneMakeNamed(name);
	if (Option.isSome(named)) return named.value;
	warnings.push(
		`TZ is "${tz}", which isn't a time zone name such as Europe/Madrid, so days and months follow UTC.`,
	);
	return DateTime.zoneMakeNamedUnsafe("UTC");
};

export const makeContext = (env: NodeJS.ProcessEnv = process.env): ProviderContext => {
	const paths = resolvePaths(env);
	const settingsIssues: Array<string> = [];
	const settingsWarnings: Array<string> = [];
	return {
		paths,
		endpoints: endpointsFrom(env),
		config: readSettings(join(paths.data, "config.json"), Settings, "SHORTS", env, settingsIssues),
		brand: readSettings(join(paths.data, "brand.json"), Brand, "SHORTS_BRAND", env, settingsIssues),
		settingsIssues,
		secret: async (key) => {
			const value = env[key.env] || (await keychain(env, key.keychain));
			return value === undefined ? undefined : Redacted.make(value);
		},
		run: runProcess,
		now: () => new Date(),
		timeZone: timeZoneFrom(env, settingsWarnings),
		settingsWarnings,
		interactive: process.stdin.isTTY === true,
		log: (line) => process.stderr.write(`${line}\n`),
	};
};
