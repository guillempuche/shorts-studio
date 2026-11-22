/**
 * `config show` and `config check` (alias `doctor`): where everything lives, which keys are set,
 * and whether the tools work. Run one before deciding something is broken.
 */

import { accessSync, constants, statSync } from "node:fs";
import { dirname } from "node:path";
import { ErrorCode, fail } from "@shorts-studio/domain/errors";
import { DateTime, Effect, Schema } from "effect";
import { type Context, type KeySpec, MCP_RESTART, settingsIssueLine } from "../context.ts";
import { caps, ledgerFile, readLedger } from "../ledger.ts";
import { jobOffers, modelChecks, modelNameFor } from "../models.ts";
import { roundUsd, usd } from "../money.ts";
import { defineOperation } from "../operation.ts";
import {
	type Check,
	Downloader,
	ImageMaker,
	MediaTools,
	type ProviderInfo,
	Transcriber,
} from "../ports.ts";
import { agentStep } from "../steps.ts";

const CheckRow = Schema.Struct({
	name: Schema.String,
	status: Schema.Literals(["ok", "warn", "fail"]),
	detail: Schema.String,
	fix: Schema.optionalKey(Schema.String),
	code: Schema.optionalKey(ErrorCode),
});

const keyCheck = async (ctx: Context, provider: string, key: KeySpec): Promise<Check> =>
	(await ctx.secret(key)) !== undefined
		? { name: key.env, status: "ok", detail: `set (${provider} needs it)` }
		: {
				name: key.env,
				status: "fail",
				detail: `missing (${provider} needs it)`,
				// In backticks, so no full stop after the command reads as part of it.
				fix:
					process.platform === "darwin"
						? `\`export ${key.env}=…\`, or: \`security add-generic-password -U -a "$USER" -s ${key.keychain} -w\`. ${MCP_RESTART} A key in the macOS Keychain is read on every call, so adding one there needs no restart.`
						: `\`export ${key.env}=…\`. ${MCP_RESTART}`,
				code: "missing-key",
			};

/**
 * Settings that can't be used, or that name no setting. Their defaults are used instead, which
 * may not be what the user wanted: a bad file or variable is a problem to fix, a fallback like
 * TZ's only a warning.
 */
const settingsChecks = (ctx: Context): ReadonlyArray<Check> => [
	...ctx.settingsIssues.map((issue) => ({
		name: "settings",
		status: "fail" as const,
		detail: settingsIssueLine(issue),
		fix: `${issue.source.startsWith("SHORTS_") ? "Fix that variable, or unset it" : "Fix that setting, or remove it"} to use the default. ${MCP_RESTART}`,
		code: "failed" as const,
	})),
	...ctx.settingsWarnings.map((warning) => ({
		name: "settings",
		status: "warn" as const,
		detail: warning,
		fix: `Fix that setting, or unset it to use the default. ${MCP_RESTART}`,
		code: "failed" as const,
	})),
];

/**
 * Why `dir` can't hold files, or undefined when it can: it's a folder this user can write, or
 * it's missing under one, since commands make the folders they need. `at` walks up from `dir` to
 * the nearest path that exists.
 */
const folderProblem = (dir: string, at = dir): string | undefined => {
	const stat = statOrMissing(at);
	if (stat === undefined) {
		const parent = dirname(at);
		return parent === at
			? `${dir} can't be made: nothing above it exists`
			: folderProblem(dir, parent);
	}
	const soCantMakeDir = at === dir ? "" : `, so ${dir} can't be made`;
	if (!stat.isDirectory()) return `${at} is a file, not a folder${soCantMakeDir}`;
	try {
		accessSync(at, constants.W_OK);
		return undefined;
	} catch {
		return `${at} can't be written by this user${soCantMakeDir}`;
	}
};

/**
 * A path's details, or undefined when it can't be looked at, as when a file stands where a
 * folder above it should be: the folder above then says what's wrong.
 */
const statOrMissing = (path: string) => {
	try {
		return statSync(path, { throwIfNoEntry: false });
	} catch {
		return undefined;
	}
};

/** A folder row: blocking, since nothing can be saved without it. It names the variable that set it. */
const folderCheck = (name: string, dir: string, setBy: string | undefined, envName: string) => {
	const problem = folderProblem(dir);
	if (problem === undefined) return { name, status: "ok" as const, detail: dir };
	return {
		name,
		status: "fail" as const,
		detail: setBy === undefined ? problem : `${problem} (set by ${setBy})`,
		fix:
			setBy === undefined
				? `Make it a folder you can write, or set ${envName} to one.`
				: `Set ${setBy} to a folder you can write, or unset it to use the default. ${MCP_RESTART}`,
		code: "failed" as const,
	};
};

/** The ledger row: the caps are checked against it, so a ledger that doesn't read blocks spending. */
const ledgerCheck = (ctx: Context): Effect.Effect<Check> =>
	readLedger(ctx).pipe(
		Effect.match({
			onSuccess: (entries): Check => ({
				name: "ledger",
				status: "ok",
				detail: entries.length === 0 ? "none yet" : ledgerFile(ctx),
			}),
			onFailure: (error): Check => ({
				name: "ledger",
				status: "fail",
				detail: error.message,
				fix: error.fix,
				code: "failed",
			}),
		}),
	);

/** A row that isn't ok carries the code a command fails with because of it. */
const withCode =
	(code: ErrorCode) =>
	(row: Check): Check =>
		row.status === "ok" || row.code !== undefined ? row : { ...row, code };

/**
 * The settings, the folders and the ledger, the models, then the tools of every provider in use,
 * then the keys they need.
 */
const runChecks = Effect.fn("runChecks")(function* (ctx: Context) {
	const offers = yield* jobOffers;
	const providers: ReadonlyArray<ProviderInfo> = [
		yield* MediaTools,
		yield* Downloader,
		...offers.map(({ offer }) => offer),
	];
	const modelRows = yield* modelChecks(ctx, offers);
	const toolRows = yield* Effect.forEach(providers, (provider) => provider.checks, {
		concurrency: "unbounded",
	});
	// One row per key, even when two providers need the same one.
	const keys = new Map(
		providers.flatMap((provider) => provider.keys.map((key) => [key.env, { provider, key }])),
	);
	// keyCheck never rejects: `secret` reads a lookup that fails as unset.
	const keyRows = yield* Effect.forEach(
		[...keys.values()],
		({ provider, key }) => Effect.promise(() => keyCheck(ctx, provider.provider, key)),
		{ concurrency: "unbounded" },
	);
	return [
		...settingsChecks(ctx),
		folderCheck("data folder", ctx.paths.data, ctx.pathsFrom.data, "SHORTS_DATA_DIR"),
		folderCheck("posts folder", ctx.paths.posts, ctx.pathsFrom.posts, "SHORTS_POSTS_DIR"),
		yield* ledgerCheck(ctx),
		...modelRows.map(withCode("failed")),
		...toolRows.flat().map(withCode("missing-tool")),
		...keyRows,
	];
});

const MARK = { ok: "✓", warn: "!", fail: "✗" } as const;

/**
 * Where a row's detail starts, past the indent, the mark and the name padded to 20, so a detail
 * of several lines stays in its column.
 */
const DETAIL_INDENT = " ".repeat(25);

/** Each row, with a blocking one's code in brackets: the code a command would fail with. */
const renderChecks = (checks: ReadonlyArray<Check>): ReadonlyArray<string> =>
	checks.flatMap((c) => {
		const detail = c.detail.replaceAll("\n", `\n${DETAIL_INDENT}`);
		const code = c.status === "fail" && c.code !== undefined ? ` [${c.code}]` : "";
		return [
			`  ${MARK[c.status]} ${c.name.padEnd(20)} ${detail}${code}`,
			...(c.fix !== undefined && c.status !== "ok" ? [`      → ${c.fix}`] : []),
		];
	});

export const configShow = defineOperation({
	name: "config_show",
	description:
		"Show the data and posts folders, spending caps, the providers in use, which of their API keys are set (never their values), whether ffmpeg, ffprobe and yt-dlp work, and every check with its status, fix and code.",
	params: {},
	output: Schema.Struct({
		paths: Schema.Struct({ data: Schema.String, posts: Schema.String }),
		caps: Schema.Struct({
			dailyUsd: Schema.Finite,
			monthlyUsd: Schema.Finite,
			postUsd: Schema.Finite,
		}),
		timeZone: Schema.String,
		imageModel: Schema.String,
		imageProvider: Schema.String,
		transcriber: Schema.String,
		checks: Schema.Array(CheckRow),
	}),
	surface: "cli-and-mcp",
	spends: false,
	hints: { readonly: true, destructive: false, idempotent: true, openWorld: false },
	run: Effect.fn("config_show")(function* (_input, ctx) {
		const transcriber = yield* Transcriber;
		const maker = yield* ImageMaker;
		const { dailyUsd, monthlyUsd, postUsd } = caps(ctx);
		return {
			paths: ctx.paths,
			caps: {
				dailyUsd: roundUsd(dailyUsd),
				monthlyUsd: roundUsd(monthlyUsd),
				postUsd: roundUsd(postUsd),
			},
			timeZone: DateTime.zoneToString(ctx.timeZone),
			imageModel: modelNameFor(ctx, maker, "image"),
			imageProvider: maker.provider,
			transcriber: `${transcriber.provider} ${modelNameFor(ctx, transcriber, "transcribe")}`,
			checks: yield* runChecks(ctx),
		};
	}),
	render: (o) => {
		const blocking = o.checks.filter((c) => c.status === "fail").length;
		return [
			`data:  ${o.paths.data}`,
			`posts: ${o.paths.posts}`,
			`caps:  ${usd(o.caps.dailyUsd)}/day, ${usd(o.caps.monthlyUsd)}/month, ${usd(o.caps.postUsd)}/post (days and months in ${o.timeZone})`,
			`transcription: ${o.transcriber}   images: ${o.imageProvider} ${o.imageModel}`,
			"",
			...renderChecks(o.checks),
			"",
			blocking === 0
				? "Ready."
				: `${blocking} blocking problem${blocking === 1 ? "" : "s"}. Fix the ✗ rows above.`,
		].join("\n");
	},
});

export const configCheck = defineOperation({
	name: "config_check",
	description:
		"Check that this machine can run shorts-studio: the settings, the data and posts folders, the spend ledger, ffmpeg with libass, ffprobe, yt-dlp, and the API keys of the providers in use. Fails and lists the fixes when something it needs is missing.",
	params: {},
	output: Schema.Struct({ checks: Schema.Array(CheckRow) }),
	surface: "cli-and-mcp",
	spends: false,
	hints: { readonly: true, destructive: false, idempotent: true, openWorld: false },
	run: (_input, ctx) =>
		runChecks(ctx).pipe(
			Effect.flatMap((checks) => {
				const blocking = checks.filter((c) => c.status === "fail");
				return blocking.length === 0
					? Effect.succeed({ checks })
					: Effect.fail(
							fail(
								"missing-tool",
								`${blocking.length} blocking problem${blocking.length === 1 ? "" : "s"}:\n${renderChecks(blocking).join("\n")}`,
								"Fix each problem listed, then run it again. `config show --json` lists every check with its status and fix.",
								[agentStep("config_show", {}, { note: "every check with its status and fix" })],
							),
						);
			}),
		),
	render: (o) => [...renderChecks(o.checks), "", "Ready."].join("\n"),
});
