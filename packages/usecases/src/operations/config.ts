/**
 * `config show` and `config check` (alias `doctor`): where everything lives, which keys are set,
 * and whether the tools work. Run one before deciding something is broken.
 */

import { fail } from "@shorts-studio/domain/errors";
import { Effect, Schema } from "effect";
import type { Context, KeySpec } from "../context.ts";
import { caps } from "../ledger.ts";
import { defineOperation } from "../operation.ts";
import {
	type Check,
	Downloader,
	ImageMaker,
	MediaTools,
	type ProviderInfo,
	Transcriber,
} from "../ports.ts";

const CheckRow = Schema.Struct({
	name: Schema.String,
	status: Schema.Literals(["ok", "warn", "fail"]),
	detail: Schema.String,
	fix: Schema.optionalKey(Schema.String),
});

const keyCheck = async (ctx: Context, provider: string, key: KeySpec): Promise<Check> =>
	(await ctx.secret(key)) !== undefined
		? { name: key.env, status: "ok", detail: `set (${provider} needs it)` }
		: {
				name: key.env,
				status: "fail",
				detail: `missing (${provider} needs it)`,
				fix:
					process.platform === "darwin"
						? `export ${key.env}=…, or: security add-generic-password -U -a "$USER" -s ${key.keychain} -w`
						: `export ${key.env}=…`,
			};

/**
 * A config.json or brand.json that isn't valid. The defaults are used instead, which may not
 * be what the user wanted.
 */
const settingsChecks = (ctx: Context): ReadonlyArray<Check> =>
	ctx.settingsIssues.map((issue) => ({
		name: "settings",
		status: "fail",
		detail: issue,
		fix: "Fix that file, or remove it to use the defaults.",
	}));

/** The settings, then the tools of every provider in use, then the keys they need. */
const runChecks = (ctx: Context) =>
	Effect.gen(function* () {
		const providers: ReadonlyArray<ProviderInfo> = [
			yield* MediaTools,
			yield* Downloader,
			yield* Transcriber,
			yield* ImageMaker,
		];
		const toolRows = yield* Effect.forEach(providers, (provider) => provider.checks, {
			concurrency: "unbounded",
		});
		// One row per key, even when two providers need the same one.
		const keys = new Map(
			providers.flatMap((provider) => provider.keys.map((key) => [key.env, { provider, key }])),
		);
		const keyRows = yield* Effect.promise(() =>
			Promise.all(
				[...keys.values()].map(({ provider, key }) => keyCheck(ctx, provider.provider, key)),
			),
		);
		return [...settingsChecks(ctx), ...toolRows.flat(), ...keyRows];
	});

const MARK = { ok: "✓", warn: "!", fail: "✗" } as const;

const renderChecks = (checks: ReadonlyArray<Check>): ReadonlyArray<string> =>
	checks.flatMap((c) => [
		`  ${MARK[c.status]} ${c.name.padEnd(20)} ${c.detail}`,
		...(c.fix !== undefined && c.status !== "ok" ? [`      → ${c.fix}`] : []),
	]);

export const configShow = defineOperation({
	name: "config_show",
	description:
		"Show the data and posts folders, spending caps, the providers in use, which of their API keys are set (never their values) and whether ffmpeg, ffprobe and yt-dlp work.",
	params: {},
	output: Schema.Struct({
		paths: Schema.Struct({ data: Schema.String, posts: Schema.String }),
		caps: Schema.Struct({ dailyUsd: Schema.Finite, postUsd: Schema.Finite }),
		imageModel: Schema.String,
		imageProvider: Schema.String,
		transcriber: Schema.String,
		checks: Schema.Array(CheckRow),
	}),
	surface: "cli-and-mcp",
	spends: false,
	hints: { readonly: true, destructive: false, idempotent: true, openWorld: false },
	run: (_input, ctx) =>
		Effect.gen(function* () {
			const transcriber = yield* Transcriber;
			const maker = yield* ImageMaker;
			return {
				paths: ctx.paths,
				caps: caps(ctx),
				imageModel: ctx.config.image?.model ?? maker.defaultModel,
				imageProvider: maker.provider,
				transcriber: `${transcriber.provider} ${ctx.config.transcribe?.model ?? transcriber.defaultModel}`,
				checks: yield* runChecks(ctx),
			};
		}),
	render: (o) => {
		const blocking = o.checks.filter((c) => c.status === "fail").length;
		return [
			`data:  ${o.paths.data}`,
			`posts: ${o.paths.posts}`,
			`caps:  $${o.caps.dailyUsd}/day, $${o.caps.postUsd}/post`,
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
		"Check that this machine can run shorts-studio: ffmpeg with libass, ffprobe, yt-dlp, and the API keys of the providers in use. Fails and lists the fixes when something it needs is missing.",
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
								"Fix the rows above, then run it again.",
							),
						);
			}),
		),
	render: (o) => [...renderChecks(o.checks), "", "Ready."].join("\n"),
});
