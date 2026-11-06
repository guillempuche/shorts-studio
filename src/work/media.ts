/**
 * Facts about media files and the external tools that handle them (ffmpeg, ffprobe, yt-dlp).
 */

import type { Context } from "../core/context.ts";

/** Duration of an audio or video file, in seconds, from ffprobe. */
export const probeDuration = async (
	ctx: Context,
	file: string,
	signal?: AbortSignal,
): Promise<number> => {
	const result = await ctx.run(
		"ffprobe",
		["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file],
		signal ? { signal } : {},
	);
	const seconds = Number.parseFloat(result.stdout.trim());
	if (result.code !== 0 || !Number.isFinite(seconds)) {
		throw new Error(`ffprobe couldn't read ${file}: ${result.stderr.trim() || "no duration"}`);
	}
	return seconds;
};

/** Whether a file has a video stream (a video export rather than an audio file). */
export const hasVideo = async (ctx: Context, file: string): Promise<boolean> => {
	const result = await ctx.run("ffprobe", [
		"-v",
		"error",
		"-select_streams",
		"v",
		"-show_entries",
		"stream=codec_type",
		"-of",
		"csv=p=0",
		file,
	]);
	return result.stdout.includes("video");
};

/** Runs ffmpeg in `cwd`; a failure carries the last lines of its stderr, where the reason is. */
export const runFfmpeg = async (
	ctx: Context,
	cwd: string,
	args: ReadonlyArray<string>,
	signal?: AbortSignal,
): Promise<void> => {
	const result = await ctx.run("ffmpeg", args, signal ? { signal, cwd } : { cwd });
	if (result.code !== 0) {
		throw new Error(
			result.stderr.trim().split("\n").slice(-5).join("\n") || `ffmpeg exited with ${result.code}`,
		);
	}
};

/** Extracts or converts the audio track to AAC in an .m4a file: one format for every source. */
export const toM4a = async (
	ctx: Context,
	input: string,
	output: string,
	signal?: AbortSignal,
): Promise<void> => {
	const result = await ctx.run(
		"ffmpeg",
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
		signal ? { signal } : {},
	);
	if (result.code !== 0)
		throw new Error(`ffmpeg couldn't extract audio from ${input}: ${result.stderr.trim()}`);
};

export interface ToolCheck {
	readonly name: string;
	readonly status: "ok" | "warn" | "fail";
	readonly detail: string;
	readonly fix?: string;
}

const firstLine = (text: string): string => text.split("\n")[0]?.trim() ?? "";

const tryRun = async (ctx: Context, file: string, args: ReadonlyArray<string>) => {
	try {
		return await ctx.run(file, args);
	} catch {
		return undefined;
	}
};

/** ffmpeg must exist and be built with libass, or captions can't be burned into drafts. */
export const checkFfmpeg = async (ctx: Context): Promise<ToolCheck> => {
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

export const checkFfprobe = async (ctx: Context): Promise<ToolCheck> => {
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

/** yt-dlp is only needed for downloads, and breaks when old, so its age matters. */
export const checkYtDlp = async (ctx: Context): Promise<ToolCheck> => {
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
	return ageDays !== undefined && ageDays > 60
		? {
				name: "yt-dlp",
				status: "warn",
				detail: `${version}, ${ageDays} days old`,
				fix: "pip install -U yt-dlp",
			}
		: { name: "yt-dlp", status: "ok", detail: version };
};
