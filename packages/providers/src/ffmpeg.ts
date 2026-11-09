/**
 * ffmpeg and ffprobe: reading durations, converting audio and rendering videos. The ffmpeg
 * must be built with libass, or captions can't be burned into drafts.
 */

import { fail, type ShortsError } from "@shorts-studio/domain/errors";
import { attempt, failWith } from "@shorts-studio/usecases/attempt";
import { type Check, MediaTools } from "@shorts-studio/usecases/ports";
import { Effect, Layer } from "effect";
import { ProviderEnv } from "./env.ts";
import { RENDERER_VERSION, renderArgs } from "./ffmpeg-render.ts";
import type { ProviderContext } from "./node.ts";
import { firstLine, tryRun } from "./process.ts";

/** The tool ran and refused the job (a bad input, a full disk), as opposed to not being installed. */
class ToolRefused extends Error {}

/**
 * A failure in words a person can act on: a tool that can't start is `missing-tool`; a tool that
 * ran but refused the job is `failed`, with `fix` for that job.
 */
const failure =
	(fix: string) =>
	(error: unknown): ShortsError =>
		error instanceof ToolRefused
			? fail("failed", error.message, fix)
			: failWith("missing-tool", "Check that ffmpeg and ffprobe work: doctor")(error);

/**
 * Runs ffmpeg, in `cwd` when given (relative paths resolve there). A refusal carries the last
 * lines of its stderr, where the reason is.
 */
const runFfmpeg = async (
	ctx: ProviderContext,
	cwd: string | undefined,
	args: ReadonlyArray<string>,
	signal: AbortSignal,
): Promise<void> => {
	const result = await ctx.run("ffmpeg", args, cwd === undefined ? { signal } : { signal, cwd });
	if (result.code !== 0) {
		throw new ToolRefused(
			result.stderr.trim().split("\n").slice(-5).join("\n") || `ffmpeg exited with ${result.code}`,
		);
	}
};

const ffmpegCheck = async (ctx: ProviderContext): Promise<Check> => {
	const version = await tryRun(ctx, "ffmpeg", ["-hide_banner", "-version"]);
	if (version === undefined || version.code !== 0) {
		return {
			name: "ffmpeg",
			status: "fail",
			detail: "not found",
			fix: "Enter the Nix shell (nix develop), or install an ffmpeg built with libass.",
		};
	}
	const filters = await tryRun(ctx, "ffmpeg", ["-hide_banner", "-filters"]);
	const hasSubtitles = filters?.stdout.includes(" subtitles ") ?? false;
	return hasSubtitles
		? { name: "ffmpeg", status: "ok", detail: firstLine(version.stdout) }
		: {
				name: "ffmpeg",
				status: "fail",
				detail: `${firstLine(version.stdout)}, without the subtitles filter (no libass)`,
				fix: "Use the Nix shell's ffmpeg-full (nix develop), or an ffmpeg built with --enable-libass.",
			};
};

const ffprobeCheck = async (ctx: ProviderContext): Promise<Check> => {
	const result = await tryRun(ctx, "ffprobe", ["-hide_banner", "-version"]);
	return result?.code === 0
		? { name: "ffprobe", status: "ok", detail: firstLine(result.stdout) }
		: {
				name: "ffprobe",
				status: "fail",
				detail: "not found",
				fix: "It ships with ffmpeg: nix develop.",
			};
};

const mediaTools = (ctx: ProviderContext): MediaTools["Service"] => ({
	provider: "ffmpeg",
	keys: [],
	checks: Effect.promise(() => Promise.all([ffmpegCheck(ctx), ffprobeCheck(ctx)])),
	rendererVersion: RENDERER_VERSION,

	duration: (file) =>
		attempt(async (signal) => {
			const result = await ctx.run(
				"ffprobe",
				["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file],
				{ signal },
			);
			const seconds = Number.parseFloat(result.stdout.trim());
			if (result.code !== 0 || !Number.isFinite(seconds)) {
				throw new ToolRefused(
					`ffprobe couldn't read ${file}: ${result.stderr.trim() || "no duration"}`,
				);
			}
			return seconds;
		}, failure("Check that the file is audio or video ffprobe can read.")),

	extractAudio: (input, output) =>
		attempt(
			(signal) =>
				runFfmpeg(
					ctx,
					undefined,
					[
						"-hide_banner",
						"-loglevel",
						"error",
						"-y",
						"-i",
						input,
						"-vn",
						"-c:a",
						"aac",
						"-b:a",
						"192k",
						output,
					],
					signal,
				),
			failure("Check that the file is audio or video ffmpeg can read."),
		),

	renderVideo: (job) =>
		attempt(
			(signal) =>
				runFfmpeg(ctx, job.cwd, renderArgs(job.beats, job.audio, job.captions, job.output), signal),
			failure("Check ffmpeg with doctor (it needs libass), then run it again."),
		),

	copyAudio: (cwd, input, output) =>
		attempt(
			(signal) =>
				runFfmpeg(
					ctx,
					cwd,
					["-hide_banner", "-loglevel", "error", "-y", "-i", input, "-c", "copy", output],
					signal,
				),
			failure("Check ffmpeg with doctor, then run it again."),
		),
});

export const ffmpegLayer = Layer.effect(
	MediaTools,
	Effect.gen(function* () {
		return MediaTools.of(mediaTools(yield* ProviderEnv));
	}),
);
