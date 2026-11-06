/**
 * `config show` and `config check` (alias `doctor`): where everything lives, which keys are set,
 * and whether the tools work. Run one before concluding something is broken.
 */

import { Effect, Schema } from "effect";
import { type Context, SECRETS, type SecretName } from "../core/context.ts";
import { fail } from "../core/errors.ts";
import { caps } from "../core/ledger.ts";
import { defineOperation } from "../core/operation.ts";
import { DEFAULT_IMAGE_MODEL } from "../work/fal.ts";
import { checkFfmpeg, checkFfprobe, checkYtDlp } from "../work/media.ts";

const Check = Schema.Struct({
	name: Schema.String,
	status: Schema.Literals(["ok", "warn", "fail"]),
	detail: Schema.String,
	fix: Schema.optionalKey(Schema.String),
});
type Check = typeof Check.Type;

/** Keys the core loop needs; no command uses the voice and music keys yet. */
const REQUIRED: ReadonlyArray<SecretName> = ["TOGETHER_API_KEY", "FAL_KEY"];

const checkKey = async (ctx: Context, name: SecretName): Promise<Check> => {
	if ((await ctx.secret(name)) !== undefined) {
		const where = (process.env[name] ?? "") !== "" ? "env" : "keychain";
		return { name, status: "ok", detail: `set (${where})` };
	}
	const required = REQUIRED.includes(name);
	return {
		name,
		status: required ? "fail" : "warn",
		detail: required ? "missing" : "missing (optional)",
		fix:
			process.platform === "darwin"
				? `export ${name}=…, or: security add-generic-password -U -a "$USER" -s ${SECRETS[name]} -w`
				: `export ${name}=… (see .env.example)`,
	};
};

/** A config.json or brand.json that doesn't parse: its defaults are in use, which may not be what the user set. */
const settingsChecks = (ctx: Context): ReadonlyArray<Check> =>
	ctx.settingsIssues.map((issue) => ({
		name: "settings",
		status: "fail",
		detail: issue,
		fix: "Fix that file, or remove it to use the defaults.",
	}));

const runChecks = async (ctx: Context): Promise<ReadonlyArray<Check>> => [
	...settingsChecks(ctx),
	...(await Promise.all([checkFfmpeg(ctx), checkFfprobe(ctx), checkYtDlp(ctx)])),
	...(await Promise.all(
		(Object.keys(SECRETS) as ReadonlyArray<SecretName>).map((name) => checkKey(ctx, name)),
	)),
];

const MARK = { ok: "✓", warn: "!", fail: "✗" } as const;

const renderChecks = (checks: ReadonlyArray<Check>): ReadonlyArray<string> =>
	checks.flatMap((c) => [
		`  ${MARK[c.status]} ${c.name.padEnd(20)} ${c.detail}`,
		...(c.fix !== undefined && c.status !== "ok" ? [`      → ${c.fix}`] : []),
	]);

export const configShow = defineOperation({
	name: "config_show",
	description:
		"Show the data and posts folders, spending caps, which API keys are set (never their values) and whether ffmpeg, ffprobe and yt-dlp work.",
	params: {},
	output: Schema.Struct({
		paths: Schema.Struct({ data: Schema.String, posts: Schema.String }),
		caps: Schema.Struct({ dailyUsd: Schema.Finite, postUsd: Schema.Finite }),
		imageModel: Schema.String,
		checks: Schema.Array(Check),
	}),
	surface: "cli-and-mcp",
	spends: false,
	hints: { readonly: true, destructive: false, idempotent: true, openWorld: false },
	run: (_input, ctx) =>
		Effect.promise(async () => ({
			paths: ctx.paths,
			caps: caps(ctx),
			imageModel: ctx.config.image?.model ?? DEFAULT_IMAGE_MODEL,
			checks: await runChecks(ctx),
		})),
	render: (o) => {
		const blocking = o.checks.filter((c) => c.status === "fail").length;
		return [
			`data:  ${o.paths.data}`,
			`posts: ${o.paths.posts}`,
			`caps:  $${o.caps.dailyUsd}/day, $${o.caps.postUsd}/post   image model: ${o.imageModel}`,
			"",
			...renderChecks(o.checks),
			"",
			blocking === 0 ? "Ready." : `${blocking} blocking. Fix the ✗ rows above.`,
		].join("\n");
	},
});

export const configCheck = defineOperation({
	name: "config_check",
	description:
		"Check that this machine can run shorts-studio (ffmpeg with libass, ffprobe, yt-dlp, API keys). Fails, with the fixes, when something blocking is missing.",
	params: {},
	output: Schema.Struct({ checks: Schema.Array(Check) }),
	surface: "cli-and-mcp",
	spends: false,
	hints: { readonly: true, destructive: false, idempotent: true, openWorld: false },
	run: (_input, ctx) =>
		Effect.promise(() => runChecks(ctx)).pipe(
			Effect.flatMap((checks) => {
				const blocking = checks.filter((c) => c.status === "fail");
				return blocking.length === 0
					? Effect.succeed({ checks })
					: Effect.fail(
							fail(
								"missing-tool",
								`${blocking.length} blocking:\n${renderChecks(blocking).join("\n")}`,
								"Fix the rows above, then run it again.",
							),
						);
			}),
		),
	render: (o) => [...renderChecks(o.checks), "", "Ready."].join("\n"),
});
