/**
 * Small file helpers every writer uses: hashes, all-or-nothing writes and lock files.
 */

import { createHash } from "node:crypto";
import {
	closeSync,
	createReadStream,
	openSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
	writeSync,
} from "node:fs";
import { fail, ShortsError } from "@shorts-studio/domain/errors";
import { Effect, Option, Schema } from "effect";
import { failWith } from "./attempt.ts";

/** SHA-256 of a file's bytes, streamed so a long audio file isn't held in memory. */
export const hashFile = (file: string): Promise<string> =>
	new Promise((resolve, reject) => {
		const hash = createHash("sha256");
		createReadStream(file)
			.on("data", (chunk) => hash.update(chunk))
			.on("error", reject)
			.on("end", () => resolve(hash.digest("hex")));
	});

/** `hashFile` as an Effect: a read error fails with a fix instead of crashing. */
export const fileHash = (file: string) =>
	Effect.tryPromise({
		try: () => hashFile(file),
		catch: failWith("failed", `Check that ${file} exists and is readable, then run it again.`),
	});

/**
 * A JSON file read through its Schema. A missing or damaged file fails with every bad field
 * named and `fix` as the next step, instead of crashing later on a wrong shape.
 */
export const readJsonFile = <S extends Schema.Codec<unknown, unknown>>(
	file: string,
	schema: S,
	fix: string,
): Effect.Effect<S["Type"], ShortsError> =>
	Effect.try({
		try: () => readFileSync(file, "utf8"),
		catch: failWith("not-found", fix),
	}).pipe(
		Effect.flatMap((text) =>
			Schema.decodeUnknownEffect(Schema.fromJsonString(schema), { errors: "all" })(text),
		),
		Effect.mapError((error) =>
			error instanceof ShortsError ? error : fail("failed", `${file}: ${error.message}`, fix),
		),
	);

/** Writes a value through its Schema as indented JSON, all or nothing. */
export const writeJsonFile = <S extends Schema.Codec<unknown, unknown>>(
	file: string,
	schema: S,
	value: S["Type"],
): Effect.Effect<void, ShortsError> =>
	Schema.encodeEffect(Schema.fromJsonString(schema, { space: 2 }))(value).pipe(
		Effect.flatMap((text) =>
			Effect.try({
				try: () => writeFileAtomic(file, `${text}\n`),
				catch: failWith("failed", `Check that ${file} can be written, then run it again.`),
			}),
		),
		Effect.mapError((error) =>
			error instanceof ShortsError
				? error
				: fail(
						"failed",
						`Can't write ${file}: ${error.message}`,
						"This is a bug: please report it.",
					),
		),
	);

/** SHA-256 of bytes already in memory. */
export const hashBytes = (bytes: Uint8Array): string =>
	createHash("sha256").update(bytes).digest("hex");

/** A stable hash of the values an output was made from. */
export const hashOf = (...parts: ReadonlyArray<unknown>): string =>
	createHash("sha256").update(JSON.stringify(parts)).digest("hex");

/**
 * Writes to a temporary file, then renames it into place. A rename within one folder happens
 * all at once, so a reader (or a run cut short by Ctrl-C) never sees half a file.
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
		// EPERM: the process exists but belongs to another user.
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
};

/** Who holds a lock: what the lock file says. */
export const LockHolder = Schema.Struct({
	pid: Schema.Int,
	command: Schema.String,
	since: Schema.String,
});
export type LockHolder = typeof LockHolder.Type;
const LockFile = Schema.fromJsonString(LockHolder);

/**
 * A lock file is written right after it's created. One that's still unreadable this long after
 * its last change was left by a process that died in between, and is safe to take over.
 */
const UNREADABLE_GRACE_MS = 1_000;

/** Who the lock file names; undefined while it's empty or damaged; "gone" once it's removed. */
const readHolder = (lockFile: string): LockHolder | undefined | "gone" => {
	try {
		return Option.getOrUndefined(
			Schema.decodeUnknownOption(LockFile)(readFileSync(lockFile, "utf8")),
		);
	} catch {
		return "gone";
	}
};

const unreadableTooLong = (lockFile: string): boolean => {
	try {
		return Date.now() - statSync(lockFile).mtimeMs > UNREADABLE_GRACE_MS;
	} catch {
		return false;
	}
};

/**
 * Takes a lock file that only one process can hold. If the process holding it is gone, or the
 * file was left empty or damaged by a crash, the lock is removed and taken over. If the holder
 * is still running, we wait for up to `waitMs`. Returns a release function, or the holder if the
 * wait runs out.
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
			writeSync(fd, Schema.encodeSync(LockFile)(holder));
			closeSync(fd);
			return { release: () => rmSync(lockFile, { force: true }) };
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		}
		const holder = readHolder(lockFile);
		if (holder === "gone") continue;
		if (holder === undefined && unreadableTooLong(lockFile)) {
			rmSync(lockFile, { force: true });
			continue;
		}
		if (holder !== undefined && !isAlive(holder.pid)) {
			rmSync(lockFile, { force: true });
			continue;
		}
		if (Date.now() > deadline && holder !== undefined) return { heldBy: holder };
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
};
