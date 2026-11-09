/**
 * Small file helpers every writer uses: hashes, all-or-nothing writes and lock files.
 */

import { createHash } from "node:crypto";
import {
	appendFileSync,
	closeSync,
	createReadStream,
	mkdirSync,
	openSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
	writeSync,
} from "node:fs";
import { uptime } from "node:os";
import { fail, type ShortsError } from "@shorts-studio/domain/errors";
import { Data, Effect, Option, Schema } from "effect";
import { failWith } from "./attempt.ts";

/**
 * SHA-256 of a file's bytes, streamed so a long audio file isn't held in memory. Interrupting it
 * stops the read.
 */
export const fileHash = (file: string): Effect.Effect<string, ShortsError> =>
	Effect.tryPromise({
		try: async (signal) => {
			const hash = createHash("sha256");
			for await (const chunk of createReadStream(file, { signal })) hash.update(chunk);
			return hash.digest("hex");
		},
		catch: failWith("failed", `Check that ${file} exists and is readable, then run it again.`),
	});

const isMissing = (error: unknown): boolean =>
	(error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";

/**
 * A file step (write, append, make a folder) as an Effect: a full disk or a folder without
 * permission fails with `fix` instead of crashing the command without one.
 */
export const fileStep = <A>(step: () => A, fix: string): Effect.Effect<A, ShortsError> =>
	Effect.try({ try: step, catch: failWith("failed", fix) });

/**
 * A text file's contents. A missing file fails as `not-found` with `fix`. Anything else (a folder
 * in its place, no permission) fails as `failed`: running the step that makes the file again
 * wouldn't help.
 */
export const readText = (file: string, fix: string): Effect.Effect<string, ShortsError> =>
	Effect.try({
		try: () => readFileSync(file, "utf8"),
		catch: (error) =>
			isMissing(error)
				? failWith("not-found", fix)(error)
				: failWith(
						"failed",
						`Check that ${file} is a file you can read, then run it again.`,
					)(error),
	});

/**
 * Writes to a temporary file, then renames it into place. A rename within one folder happens
 * all at once, so a reader (or a run cut short by Ctrl-C) never sees half a file.
 */
export const writeFileAtomic = (
	file: string,
	data: string | Uint8Array,
): Effect.Effect<void, ShortsError> =>
	fileStep(
		() => writeAtomicSync(file, data),
		`Check that the folder of ${file} exists and can be written, and that the disk isn't full.`,
	);

export const appendText = (file: string, text: string): Effect.Effect<void, ShortsError> =>
	fileStep(
		() => appendFileSync(file, text),
		`Check that ${file} can be written, and that the disk isn't full.`,
	);

export const ensureDir = (dir: string): Effect.Effect<void, ShortsError> =>
	fileStep(() => {
		mkdirSync(dir, { recursive: true });
	}, `Check that ${dir} can be created: its parent must be a folder you can write to.`);

/**
 * A JSON file read through its Schema. A missing or damaged file fails with every bad field
 * named and `fix` as the next step, instead of crashing later on a wrong shape.
 */
export const readJsonFile = <S extends Schema.Codec<unknown, unknown>>(
	file: string,
	schema: S,
	fix: string,
): Effect.Effect<S["Type"], ShortsError> =>
	readText(file, fix).pipe(
		Effect.flatMap((text) =>
			Schema.decodeUnknownEffect(Schema.fromJsonString(schema), { errors: "all" })(text).pipe(
				Effect.mapError((error) => fail("failed", `${file}: ${error.message}`, fix)),
			),
		),
	);

/** Writes a value through its Schema as indented JSON, all or nothing. */
export const writeJsonFile = <S extends Schema.Codec<unknown, unknown>>(
	file: string,
	schema: S,
	value: S["Type"],
): Effect.Effect<void, ShortsError> =>
	Schema.encodeEffect(Schema.fromJsonString(schema, { space: 2 }))(value).pipe(
		Effect.mapError((error) =>
			fail("failed", `Can't write ${file}: ${error.message}`, "This is a bug: please report it."),
		),
		Effect.flatMap((text) => writeFileAtomic(file, `${text}\n`)),
	);

export const hashBytes = (bytes: Uint8Array): string =>
	createHash("sha256").update(bytes).digest("hex");

/** A stable hash of the values an output was made from. */
export const hashOf = (...parts: ReadonlyArray<unknown>): string =>
	createHash("sha256").update(JSON.stringify(parts)).digest("hex");

const writeAtomicSync = (file: string, data: string | Uint8Array): void => {
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

/**
 * Who the lock file names; undefined while it's empty or damaged; "gone" once it's removed.
 * Any other read error (a folder in its place, no permission) is thrown: retrying won't fix it.
 */
const readHolder = (lockFile: string): LockHolder | undefined | "gone" => {
	try {
		return Option.getOrUndefined(
			Schema.decodeUnknownOption(LockFile)(readFileSync(lockFile, "utf8")),
		);
	} catch (error) {
		if (isMissing(error)) return "gone";
		throw error;
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
 * Clocks are often corrected soon after a machine starts, which moves its computed start time. A
 * lock counts as older than the start only past this margin, so a correction can't free a live one.
 */
const CLOCK_SLACK_MS = 10 * 60_000;

/** Taken before this machine last started: its pid may now belong to another program. */
const fromBeforeBoot = (holder: LockHolder): boolean =>
	Date.parse(holder.since) < Date.now() - uptime() * 1000 - CLOCK_SLACK_MS;

/** A lock this process holds. */
export interface Lock {
	readonly release: () => void;
}

/**
 * Another process holds the lock. `holder` is undefined while that process is still writing the
 * file.
 */
export class LockBusy extends Data.TaggedError("LockBusy")<{
	readonly holder: LockHolder | undefined;
}> {}

/**
 * One try at a lock file that only one process can hold. A lock whose process is gone, or that
 * a crash left empty or damaged, is removed and taken over.
 *
 * Two processes can both find the same lock stale and both take it over. That needs a crash
 * first and two commands in the same instant, so it's accepted; releasing removes only a lock
 * that still names this process, so neither removes the other's.
 */
const tryLock = (lockFile: string, command: string): Lock | LockBusy => {
	for (;;) {
		try {
			const holder: LockHolder = { pid: process.pid, command, since: new Date().toISOString() };
			const content = Schema.encodeSync(LockFile)(holder);
			const fd = openSync(lockFile, "wx");
			let saved = false;
			try {
				writeSync(fd, content);
				saved = true;
			} finally {
				closeSync(fd);
				// An empty lock would block every other command until it's judged stale.
				if (!saved) rmSync(lockFile, { force: true });
			}
			return {
				release: () => {
					try {
						if (readFileSync(lockFile, "utf8") === content) rmSync(lockFile, { force: true });
					} catch {
						// Already gone, or unreadable: there's nothing of ours to remove.
					}
				},
			};
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		}
		const holder = readHolder(lockFile);
		if (holder === "gone") continue;
		const stale =
			holder === undefined
				? unreadableTooLong(lockFile)
				: !isAlive(holder.pid) || fromBeforeBoot(holder);
		if (!stale) return new LockBusy({ holder });
		rmSync(lockFile, { force: true });
	}
};

/** One try at `lockFile`: the lock, `LockBusy`, or a failure when the file can't be used at all. */
export const takeLock = (
	lockFile: string,
	command: string,
): Effect.Effect<Lock, LockBusy | ShortsError> =>
	Effect.try({
		try: () => tryLock(lockFile, command),
		catch: failWith(
			"failed",
			`Check that ${lockFile} is a file this user can read and write, in a folder that exists.`,
		),
	}).pipe(
		Effect.flatMap((lock) => (lock instanceof LockBusy ? Effect.fail(lock) : Effect.succeed(lock))),
	);
