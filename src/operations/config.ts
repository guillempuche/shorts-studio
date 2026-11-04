/**
 * `config show`: where everything lives, which keys are set, and whether the tools work. The
 * first command to run on a new machine, and the one to run before concluding something is
 * broken.
 */

import { Effect, Schema } from "effect";
import { DEFAULT_CAPS, SECRETS, type SecretName } from "../core/context.ts";
import { defineOperation } from "../core/operation.ts";
import { DEFAULT_IMAGE_MODEL } from "../work/fal.ts";
import { checkFfmpeg, checkFfprobe, checkYtDlp } from "../work/media.ts";

const Check = Schema.Struct({
	name: Schema.String,
	status: Schema.Literals(["ok", "warn", "fail"]),
	detail: Schema.String,
	fix: Schema.optionalKey(Schema.String),
});

/** Keys each milestone-1 step needs; the rest are reported but not required. */
const REQUIRED: ReadonlyArray<SecretName> = ["TOGETHER_API_KEY", "FAL_KEY"];

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
		Effect.promise(async () => {
			const keys = await Promise.all(
				(Object.keys(SECRETS) as ReadonlyArray<SecretName>).map(
					async (name): Promise<typeof Check.Type> => {
						const fromEnv = (process.env[name] ?? "") !== "";
						const value = fromEnv
							? "env"
							: (await ctx.secret(name)) !== undefined
								? "keychain"
								: undefined;
						if (value !== undefined) return { name, status: "ok", detail: `set (${value})` };
						return {
							name,
							status: REQUIRED.includes(name) ? "fail" : "warn",
							detail: REQUIRED.includes(name) ? "missing" : "missing (later milestones)",
							fix:
								process.platform === "darwin"
									? `export ${name}=…, or: security add-generic-password -U -a "$USER" -s ${SECRETS[name]} -w`
									: `export ${name}=… (see .env.example)`,
						};
					},
				),
			);
			const tools = await Promise.all([checkFfmpeg(ctx), checkFfprobe(ctx), checkYtDlp(ctx)]);
			return {
				paths: ctx.paths,
				caps: { ...DEFAULT_CAPS, ...ctx.config.caps },
				imageModel: ctx.config.image?.model ?? DEFAULT_IMAGE_MODEL,
				checks: [...tools, ...keys],
			};
		}),
	render: (o) => {
		const mark = { ok: "✓", warn: "!", fail: "✗" } as const;
		const rows = o.checks.flatMap((c) => [
			`  ${mark[c.status]} ${c.name.padEnd(20)} ${c.detail}`,
			...(c.fix !== undefined && c.status !== "ok" ? [`      → ${c.fix}`] : []),
		]);
		const blocking = o.checks.filter((c) => c.status === "fail").length;
		return [
			`data:  ${o.paths.data}`,
			`posts: ${o.paths.posts}`,
			`caps:  $${o.caps.dailyUsd}/day, $${o.caps.postUsd}/post   image model: ${o.imageModel}`,
			"",
			...rows,
			"",
			blocking === 0 ? "Ready." : `${blocking} blocking. Fix the ✗ rows above.`,
		].join("\n");
	},
});
