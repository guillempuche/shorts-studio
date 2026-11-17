/**
 * The Node side of `Context`: folders from the environment, settings files, API keys from the
 * environment or the macOS Keychain, and what providers need to reach the outside world.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { closest } from "@shorts-studio/domain/closest";
import { issueLine, schemaIssues } from "@shorts-studio/domain/errors";
import {
	Brand,
	type CapsFrom,
	type Context,
	type Paths,
	Config as Settings,
	type SettingsIssue,
} from "@shorts-studio/usecases/context";
import {
	DateTime,
	Option,
	Redacted,
	Result,
	Schema,
	type SchemaAST,
	type SchemaIssue,
} from "effect";
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

type Risk = SettingsIssue["risk"];

/** One settings file: where it is, its Schema, and the prefix of the variables that override it. */
interface SettingsFile<S extends Schema.Codec<unknown, unknown>> {
	readonly file: string;
	readonly schema: S;
	readonly envPrefix: string;
	/** What a problem with the setting at `path`, or with the whole file, puts at risk. */
	readonly riskOf: (path?: string) => Risk;
}

/** A problem anywhere in config.json drops the whole file, caps included. */
const configRisk = (path?: string): Risk =>
	path === undefined || path === "caps" || path.startsWith("caps.") ? "caps" : "setting";

const brandRisk = (): Risk => "brand";

/**
 * A settings file with its `SHORTS_…` environment overrides, checked against its Schema. Each
 * value comes from the environment if set there, then from the file, then the built-in default:
 * `SHORTS_IMAGE_MODEL=flux-dev` replaces only `image.model` from config.json. A file that isn't
 * valid is left out, and why goes to `issues`; the environment's settings still apply. So does a
 * key that names no setting, while the rest of the file applies. `fromEnv` holds the paths of
 * the settings a variable set.
 */
const readSettings = <S extends Schema.Codec<unknown, unknown>>(
	{ file, schema, envPrefix, riskOf }: SettingsFile<S>,
	env: NodeJS.ProcessEnv,
	issues: Array<SettingsIssue>,
): { readonly value: S["Type"]; readonly fromEnv: ReadonlySet<string> } => {
	const decode = Schema.decodeUnknownResult(schema, { errors: "all" });
	const fromText = leafFromText(schema);
	const { overrides, fromEnv } = envOverrides(schema, fromText, envPrefix, riskOf, env, issues);
	if (existsSync(file)) {
		const parsed = Schema.decodeUnknownResult(Schema.fromJsonString(Schema.Unknown))(
			readFileSync(file, "utf8"),
		);
		const result = Result.isSuccess(parsed)
			? decode(overlay(numbersFromText(schema, fromText, parsed.success), overrides))
			: parsed;
		if (Result.isFailure(result)) {
			issues.push({ source: file, risk: riskOf(), text: issueLine(result.failure) });
		}
		if (Result.isSuccess(parsed)) issues.push(...unknownKeys(file, schema, riskOf, parsed.success));
		if (Result.isSuccess(result)) return { value: result.success, fromEnv };
	}
	// Each override was checked on its own, so together they always decode.
	return { value: Result.getOrElse(decode(overrides), () => ({})), fromEnv };
};

/**
 * The keys in a settings file that name no setting, each with the one it most likely meant. A
 * second decode that fails on them finds them; the first one drops them, so the rest of the
 * file still applies.
 */
const unknownKeys = <S extends Schema.Codec<unknown, unknown>>(
	file: string,
	schema: S,
	riskOf: (path?: string) => Risk,
	saved: unknown,
): Array<SettingsIssue> => {
	const strict = Schema.decodeUnknownResult(schema, { errors: "all", onExcessProperty: "error" })(
		saved,
	);
	if (Result.isSuccess(strict)) return [];
	return unexpectedKeys(strict.failure.issue).map(({ path, siblings }) => {
		const name = path.join(".");
		const group = path.slice(0, -1);
		const near = closest(path.at(-1) ?? "", siblings);
		const meant = near === undefined ? undefined : [...group, near].join(".");
		const where = group.length === 0 ? "the file" : group.join(".");
		// `$schema` only points editors at the file's Schema, so it isn't listed as a setting.
		const settingKeys = siblings.filter((key) => !key.startsWith("$"));
		return {
			source: file,
			// A key in caps, or one meant as a cap, may leave a cap at its default.
			risk: [name, meant].some((key) => key !== undefined && riskOf(key) === "caps")
				? "caps"
				: riskOf(name),
			text:
				meant === undefined
					? `${name} isn't a setting; ${where} has ${listed(settingKeys)}.`
					: `${name} isn't a setting; the closest is ${meant}.`,
			...(meant === undefined ? {} : { setting: meant }),
		};
	});
};

/** Every key a strict decode found unexpected: its path, and the keys its object takes. */
const unexpectedKeys = (
	issue: SchemaIssue.Issue,
	path: ReadonlyArray<string> = [],
): Array<{ readonly path: ReadonlyArray<string>; readonly siblings: ReadonlyArray<string> }> => {
	switch (issue._tag) {
		case "Pointer":
			return unexpectedKeys(issue.issue, [...path, ...issue.path.map(String)]);
		case "Filter":
		case "Encoding":
			return unexpectedKeys(issue.issue, path);
		case "Composite":
		case "AnyOf":
			return issue.issues.flatMap((inner) => unexpectedKeys(inner, path));
		case "UnexpectedKey":
			return [
				{
					path,
					siblings:
						issue.ast._tag === "Objects"
							? issue.ast.propertySignatures.flatMap(({ name }) =>
									typeof name === "string" ? [name] : [],
								)
							: [],
				},
			];
		default:
			return [];
	}
};

/** `a, b and c`. */
const listed = (names: ReadonlyArray<string>): string =>
	names.length <= 1
		? (names[0] ?? "nothing")
		: `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

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
 * The settings the environment sets, each decoded from its text, and the paths it set. One that
 * isn't valid is left out, and why goes to `issues`, naming its variable: the rest still apply.
 */
const envOverrides = <S extends Schema.Codec<unknown, unknown>>(
	schema: S,
	fromText: LeafFromText,
	prefix: string,
	riskOf: (path?: string) => Risk,
	env: NodeJS.ProcessEnv,
	issues: Array<SettingsIssue>,
): { readonly overrides: unknown; readonly fromEnv: ReadonlySet<string> } => {
	let overrides: unknown = {};
	const fromEnv = new Set<string>();
	for (const path of settingPaths(schema.ast)) {
		const name = envName(prefix, path);
		const value = env[name];
		// An empty variable is unset, as most shells and tools treat it.
		if (!value) continue;
		const decoded = fromText(path, value);
		if (Result.isSuccess(decoded)) {
			overrides = overlay(overrides, decoded.success);
			fromEnv.add(path.join("."));
		} else {
			issues.push({
				source: name,
				risk: riskOf(path.join(".")),
				text: schemaIssues(decoded.failure)
					.map((issue) => issue.message)
					.join("; "),
				setting: path.join("."),
			});
		}
	}
	return { overrides, fromEnv };
};

/**
 * `SHORTS_` variables that aren't settings: the folders, a provider's address
 * (`SHORTS_FAL_URL`), and the installer's.
 */
const NOT_SETTINGS = new Set([
	"SHORTS_DATA_DIR",
	"SHORTS_POSTS_DIR",
	"SHORTS_INSTALL_DIR",
	"SHORTS_VERSION",
]);
const ADDRESS = /^SHORTS_([A-Z0-9]+(?:_[A-Z0-9]+)*)_URL$/;

/** Each setting's variable and its path, for the variables of one settings file. */
const variablesOf = (schema: Schema.Top, prefix: string) =>
	settingPaths(schema.ast).map((path) => ({
		variable: envName(prefix, path),
		path: path.join("."),
	}));

/**
 * Every `SHORTS_` variable that names no setting, with the one it most likely meant. Without
 * this, a misspelt `SHORTS_CAPS_DAILY` would leave the daily cap at its default unnoticed.
 */
const unknownVariables = (env: NodeJS.ProcessEnv): Array<SettingsIssue> => {
	const config = variablesOf(Settings, "SHORTS");
	const brand = variablesOf(Brand, "SHORTS_BRAND");
	const known = new Set([...config, ...brand].map(({ variable }) => variable));
	return Object.entries(env).flatMap(([name, value]): Array<SettingsIssue> => {
		if (!name.startsWith("SHORTS_") || !value) return [];
		if (known.has(name) || NOT_SETTINGS.has(name) || ADDRESS.test(name)) return [];
		if (name.startsWith("SHORTS_MODELS_")) {
			return [
				{
					source: name,
					risk: "setting",
					text: "not a setting: models are set in config.json only, under models.",
				},
			];
		}
		const isBrand = name.startsWith("SHORTS_BRAND_");
		const settings = isBrand ? brand : config;
		const near = closest(
			name,
			settings.map(({ variable }) => variable),
		);
		const meant = settings.find(({ variable }) => variable === near);
		const capsAtRisk =
			name.startsWith("SHORTS_CAPS_") || (meant !== undefined && configRisk(meant.path) === "caps");
		const risk: Risk = isBrand ? "brand" : capsAtRisk ? "caps" : "setting";
		if (meant !== undefined) {
			return [
				{
					source: name,
					risk,
					text: `not a setting; the closest is ${meant.variable}.`,
					setting: meant.path,
				},
			];
		}
		// The variables that start with the same word (SHORTS_CAPS_…), else all of the file's.
		const prefix = isBrand ? "SHORTS_BRAND_" : "SHORTS_";
		const word = `${prefix}${name.slice(prefix.length).split("_")[0]?.toUpperCase()}_`;
		const alike = settings.filter(({ variable }) => variable.startsWith(word));
		const which =
			alike.length > 0 ? "the ones that start like it" : `${isBrand ? "brand" : "config"}.json's`;
		const shown = (alike.length > 0 ? alike : settings).map(({ variable }) => variable);
		return [{ source: name, risk, text: `not a setting; ${which} are ${listed(shown)}.` }];
	});
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
			const provider = ADDRESS.exec(name)?.[1];
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

/** `ps`'s elapsed time, `[[dd-]hh:]mm:ss`, as on macOS and Linux. */
const ETIME = /^(?:(?:(\d+)-)?(\d+):)?(\d+):(\d+)$/;

/** Seconds since a process started, from `ps -o etime=`; undefined for anything else. */
export const elapsedSeconds = (etime: string): number | undefined => {
	const match = ETIME.exec(etime.trim());
	if (match === null) return undefined;
	const [, days = "0", hours = "0", minutes = "0", seconds = "0"] = match;
	return ((Number(days) * 24 + Number(hours)) * 60 + Number(minutes)) * 60 + Number(seconds);
};

/** A lock waits on this, so `ps` gets a short time to answer. */
const PS_DEADLINE_MS = 2_000;

/**
 * When process `pid` started, from `ps -o etime=`. Undefined on Windows, where there's no `ps`,
 * and when `ps` fails, takes too long or finds no such process.
 */
export const processStartedAt = async (
	pid: number,
	run: typeof runProcess = runProcess,
	platform: NodeJS.Platform = process.platform,
): Promise<Date | undefined> => {
	if (platform === "win32") return undefined;
	// Read before `ps` runs, so a slow answer can only make the start look earlier: that keeps
	// the lock rather than taking it over.
	const asked = Date.now();
	const found = await tryRun(
		{ run: (file, args) => run(file, args, { signal: AbortSignal.timeout(PS_DEADLINE_MS) }) },
		"ps",
		["-o", "etime=", "-p", String(pid)],
	);
	const seconds = found?.code === 0 ? elapsedSeconds(found.stdout) : undefined;
	return seconds === undefined ? undefined : new Date(asked - seconds * 1000);
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

/**
 * Variables a coding agent sets in every shell it runs. Add one only once it's known to be set in
 * all of that agent's modes, or approvals would pass where it isn't.
 */
const AGENT_MARKERS: ReadonlyArray<string> = ["CLAUDECODE"];

const agentShellFrom = (env: NodeJS.ProcessEnv): string | undefined =>
	AGENT_MARKERS.find((variable) => (env[variable] ?? "") !== "");

/** Where each cap was set: its variable, else config.json when the file set it, else its default. */
const capsFromOf = (
	config: { readonly value: Settings; readonly fromEnv: ReadonlySet<string> },
	configFile: string,
): CapsFrom => {
	const from = (cap: keyof CapsFrom) =>
		config.fromEnv.has(`caps.${cap}`)
			? envName("SHORTS", ["caps", cap])
			: config.value.caps?.[cap] === undefined
				? "default"
				: configFile;
	return { dailyUsd: from("dailyUsd"), monthlyUsd: from("monthlyUsd"), postUsd: from("postUsd") };
};

export const makeContext = (env: NodeJS.ProcessEnv = process.env): ProviderContext => {
	const paths = resolvePaths(env);
	const settingsIssues: Array<SettingsIssue> = [];
	const settingsWarnings: Array<string> = [];
	const configFile = join(paths.data, "config.json");
	const config = readSettings(
		{ file: configFile, schema: Settings, envPrefix: "SHORTS", riskOf: configRisk },
		env,
		settingsIssues,
	);
	const brand = readSettings(
		{
			file: join(paths.data, "brand.json"),
			schema: Brand,
			envPrefix: "SHORTS_BRAND",
			riskOf: brandRisk,
		},
		env,
		settingsIssues,
	);
	settingsIssues.push(...unknownVariables(env));
	return {
		paths,
		// resolvePaths reads an empty variable as unset too.
		pathsFrom: {
			data: env["SHORTS_DATA_DIR"] ? "SHORTS_DATA_DIR" : undefined,
			posts: env["SHORTS_POSTS_DIR"] ? "SHORTS_POSTS_DIR" : undefined,
		},
		endpoints: endpointsFrom(env),
		config: config.value,
		brand: brand.value,
		capsFrom: capsFromOf(config, configFile),
		settingsIssues,
		secret: async (key) => {
			const value = env[key.env] || (await keychain(env, key.keychain));
			return value === undefined ? undefined : Redacted.make(value);
		},
		run: runProcess,
		now: () => new Date(),
		processStartedAt: (pid) => processStartedAt(pid),
		timeZone: timeZoneFrom(env, settingsWarnings),
		settingsWarnings,
		interactive: process.stdin.isTTY === true,
		agentShell: agentShellFrom(env),
		log: (line) => process.stderr.write(`${line}\n`),
	};
};
