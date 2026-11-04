/**
 * Small filesystem rules every writer follows: hashes, atomic writes and lock files.
 */

import { createHash } from "node:crypto";
import {
	closeSync,
	createReadStream,
	openSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
	writeSync,
} from "node:fs";

/** SHA-256 of a file's bytes, streamed so a long audio file isn't held in memory. */
export const hashFile = (file: string): Promise<string> =>
	new Promise((resolve, reject) => {
		const hash = createHash("sha256");
		createReadStream(file)
			.on("data", (chunk) => hash.update(chunk))
			.on("error", reject)
			.on("end", () => resolve(hash.digest("hex")));
	});

/** SHA-256 of bytes already in memory. */
export const hashBytes = (bytes: Uint8Array): string =>
	createHash("sha256").update(bytes).digest("hex");

/** A stable hash of the values an output was made from. */
export const hashOf = (...parts: ReadonlyArray<unknown>): string =>
	createHash("sha256").update(JSON.stringify(parts)).digest("hex");

/**
 * Writes through a temporary file and a rename, so a reader (or a run cut short by Ctrl-C)
 * never sees half a file. The rename is atomic within one folder.
 */
export const writeFileAtomic = (file: string, data: string | Uint8Array): void => {
	const tmp = `${file}.${process.pid}.tmp`;
	try {
		writeFileSync(tmp, data);
		renameSync(tmp, file);
	} finally {
		rmSync(tmp, { force: true });
	}
};

const isAlive = (pid: number): boolean => {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		// EPERM: it exists but belongs to someone else.
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
};

export interface LockHolder {
	readonly pid: number;
	readonly command: string;
	readonly since: string;
}

/**
 * Takes an exclusive lock file. A lock whose process is gone is broken and taken over; one
 * held by a live process is waited on, up to `waitMs`. Returns a release function, or the
 * holder when the wait ran out.
 */
export const acquireLock = async (
	lockFile: string,
	command: string,
	waitMs = 10_000,
): Promise<{ readonly release: () => void } | { readonly heldBy: LockHolder }> => {
	const deadline = Date.now() + waitMs;
	for (;;) {
		try {
			const fd = openSync(lockFile, "wx");
			const holder: LockHolder = { pid: process.pid, command, since: new Date().toISOString() };
			writeSync(fd, JSON.stringify(holder));
			closeSync(fd);
			return { release: () => rmSync(lockFile, { force: true }) };
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		}
		let holder: LockHolder | undefined;
		try {
			holder = JSON.parse(readFileSync(lockFile, "utf8")) as LockHolder;
		} catch {
			// Being written or removed right now: look again.
		}
		if (holder !== undefined && !isAlive(holder.pid)) {
			rmSync(lockFile, { force: true });
			continue;
		}
		if (Date.now() > deadline && holder !== undefined) return { heldBy: holder };
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
};
