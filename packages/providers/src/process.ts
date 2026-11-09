/**
 * Running an external program (ffmpeg, ffprobe), and stopping it when its work is abandoned.
 *
 * Plain `spawn`, not Effect's process spawner: docs/architecture.md#key-decisions says why.
 */

import { spawn } from "node:child_process";

/** How long a process gets to exit after SIGTERM before it is sent SIGKILL. */
export const LET_GO_TIMEOUT_MS = 5_000;

/**
 * Stops a process when its work is abandoned: first ask (SIGTERM), then force (SIGKILL).
 * Returns a function to call once the process has ended, so neither the abort listener nor the
 * pending kill outlives it.
 *
 * Don't also pass the same signal to `spawn`: Node would then send its own SIGTERM, with no
 * SIGKILL to follow if the program ignores it.
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
		// Decoded by the stream, so a character split across two chunks (é in a path) stays whole.
		proc.stdout.setEncoding("utf8").on("data", (chunk: string) => {
			stdout += chunk;
		});
		proc.stderr.setEncoding("utf8").on("data", (chunk: string) => {
			stderr += chunk;
		});
		proc.on("error", (error) => {
			// Only a program that never started ends here. A started one also emits `error` when a
			// kill fails, and is answered on `close`, so its pending SIGKILL isn't cancelled early.
			if (proc.pid !== undefined) return;
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
