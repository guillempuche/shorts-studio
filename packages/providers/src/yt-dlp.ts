/**
 * Downloads with the user's own yt-dlp: never bundled, because Instagram and TikTok break old
 * versions often. Audio only, as mp3, with pauses between posts so the account isn't
 * rate-limited or flagged. Browser cookies (Instagram needs a login) are used only when
 * `download.cookiesFromBrowser` is set in config.json.
 */

import { attempt, failWith } from "@shorts-studio/usecases/attempt";
import { type Check, Downloader, type DownloadResult } from "@shorts-studio/usecases/ports";
import { Effect, Layer } from "effect";
import { ProviderEnv } from "./env.ts";
import type { ProviderContext } from "./node.ts";
import { tryRun } from "./process.ts";

/** yt-dlp needs updating once it's this old: the platforms change faster than that. */
const MAX_AGE_DAYS = 60;

const versionCheck = async (ctx: ProviderContext): Promise<Check> => {
	const result = await tryRun(ctx, "yt-dlp", ["--version"]);
	if (result?.code !== 0) {
		return {
			name: "yt-dlp",
			status: "warn",
			detail: "not found (only needed to download reels)",
			fix: "pip install -U yt-dlp",
		};
	}
	const version = result.stdout.trim();
	const match = /^(\d{4})\.(\d{2})\.(\d{2})/.exec(version);
	const ageDays =
		match === null
			? undefined
			: Math.floor(
					(ctx.now().getTime() - Date.parse(`${match[1]}-${match[2]}-${match[3]}`)) / 86_400_000,
				);
	return ageDays !== undefined && ageDays > MAX_AGE_DAYS
		? {
				name: "yt-dlp",
				status: "warn",
				detail: `${version}, ${ageDays} days old`,
				fix: "pip install -U yt-dlp",
			}
		: { name: "yt-dlp", status: "ok", detail: version };
};

const downloader = (ctx: ProviderContext): Downloader["Service"] => {
	const common = (): ReadonlyArray<string> => [
		...(ctx.config.download?.cookiesFromBrowser !== undefined
			? ["--cookies-from-browser", ctx.config.download.cookiesFromBrowser]
			: []),
		"--extract-audio",
		"--audio-format",
		"mp3",
		"--sleep-interval",
		"5",
		"--max-sleep-interval",
		"15",
		"--no-progress",
	];

	const run = (cwd: string, args: ReadonlyArray<string>) =>
		attempt(
			async (signal): Promise<DownloadResult> => {
				const result = await ctx.run("yt-dlp", [...common(), ...args], { signal, cwd });
				return {
					ok: result.code === 0,
					errors: result.stderr
						.split("\n")
						.filter((line) => line.includes("ERROR"))
						.join("\n"),
				};
			},
			failWith("missing-tool", "Install yt-dlp: pip install -U yt-dlp"),
		);

	return {
		provider: "yt-dlp",
		keys: [],
		checks: Effect.promise(async () => [await versionCheck(ctx)]),
		downloadList: (job) =>
			run(job.cwd, [
				"--download-archive",
				job.archiveFile,
				"--output",
				job.output,
				"--batch-file",
				job.urlsFile,
			]),
		// `--` ends the options, so a URL that starts with "-" can't be read as one.
		downloadOne: (job) => run(job.cwd, ["--output", job.output, "--", job.url]),
	};
};

export const ytDlpLayer = Layer.effect(
	Downloader,
	Effect.gen(function* () {
		return Downloader.of(downloader(yield* ProviderEnv));
	}),
);
