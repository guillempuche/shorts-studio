/**
 * Running an external program (ffmpeg, ffprobe), and stopping it when its work is abandoned.
 *
 * We use plain `spawn`, not Effect's process spawner. On macOS and Linux that one detaches
 * child processes, so a Ctrl-C could leave ffmpeg encoding (content-studio docs/effect.md has
 * the measurement). The stopping logic comes from content-studio's `stopWhenAborted`.
 */

import { spawn } from "node:child_process";

/** How long a process gets to exit after SIGTERM before it is sent SIGKILL. */
export const LET_GO_TIMEOUT_MS = 5_000;

/**
 * Stops a process when its work is abandoned: first ask (SIGTERM), then force (SIGKILL).
 * Returns a function to call once the process has ended, so neither the abort listener nor the
 * pending kill outlives it.
 *
 * Don't also pass the same signal to `spawn`: its early `error` event would end the run and
 * cancel the kill.
 */
export function stopWhenAborted(
	proc: { kill: (signal: NodeJS.Signals) => boolean },
	signal: AbortSignal | undefined,
	afterMs: number = LET_GO_TIMEOUT_MS,
): () => void {
	let pendingKill: NodeJS.Timeout | undefined;
	const stop = (): void => {
		proc.kill("SIGTERM");
		pendingKill = setTimeout(() => proc.kill("SIGKILL"), afterMs);
		pendingKill.unref?.();
	};
	if (signal?.aborted === true) stop();
	else signal?.addEventListener("abort", stop, { once: true });
	return () => {
		if (pendingKill !== undefined) clearTimeout(pendingKill);
		signal?.removeEventListener("abort", stop);
	};
}

export interface RunResult {
	readonly code: number | null;
	readonly stdout: string;
	readonly stderr: string;
}

/** Runs a program to completion and collects its output. Rejects only if it can't start. */
export const runProcess = (
	file: string,
	args: ReadonlyArray<string>,
	options: { readonly signal?: AbortSignal; readonly cwd?: string } = {},
): Promise<RunResult> =>
	new Promise((resolve, reject) => {
		const proc = spawn(file, [...args], {
			cwd: options.cwd,
			stdio: ["ignore", "pipe", "pipe"],
		});
		const release = stopWhenAborted(proc, options.signal);
		let stdout = "";
		let stderr = "";
		proc.stdout.on("data", (chunk: Buffer) => {
			stdout += chunk.toString();
		});
		proc.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});
		proc.on("error", (error) => {
			release();
			reject(error);
		});
		proc.on("close", (code) => {
			release();
			resolve({ code, stdout, stderr });
		});
	});

/** Runs a program for a check; undefined when it can't even start (not installed). */
export const tryRun = async (
	ctx: { readonly run: (file: string, args: ReadonlyArray<string>) => Promise<RunResult> },
	file: string,
	args: ReadonlyArray<string>,
): Promise<RunResult | undefined> => {
	try {
		return await ctx.run(file, args);
	} catch {
		return undefined;
	}
};

export const firstLine = (text: string): string => text.split("\n")[0]?.trim() ?? "";
