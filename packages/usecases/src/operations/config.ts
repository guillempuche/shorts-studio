/**
 * `config show` and `config check` (alias `doctor`): where everything lives, which keys are set,
 * and whether the tools work. Run one before deciding something is broken.
 */

import { fail } from "@shorts-studio/domain/errors";
import { DateTime, Effect, Schema } from "effect";
import type { Context, KeySpec } from "../context.ts";
import { caps } from "../ledger.ts";
import { jobOffers, modelChecks, modelNameFor } from "../models.ts";
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
 * Settings that aren't valid. Their defaults are used instead, which may not be what the user
 * wanted: a bad file or variable is a problem to fix, a fallback like TZ's only a warning.
 */
const settingsChecks = (ctx: Context): ReadonlyArray<Check> => [
	...ctx.settingsIssues.map((issue) => ({
		name: "settings",
		status: "fail" as const,
		detail: issue,
		fix: "Fix that setting, or remove it to use the default.",
	})),
	...ctx.settingsWarnings.map((warning) => ({
		name: "settings",
		status: "warn" as const,
		detail: warning,
		fix: "Fix that setting, or unset it to use the default.",
	})),
];

/** The settings and models, then the tools of every provider in use, then the keys they need. */
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
	return [...settingsChecks(ctx), ...modelRows, ...toolRows.flat(), ...keyRows];
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
		return {
			paths: ctx.paths,
			caps: caps(ctx),
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
			`caps:  $${o.caps.dailyUsd}/day, $${o.caps.monthlyUsd}/month, $${o.caps.postUsd}/post (days and months in ${o.timeZone})`,
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
