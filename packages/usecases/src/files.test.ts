import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { uptime } from "node:os";
import { join } from "node:path";
import { fail } from "@shorts-studio/domain/errors";
import { Effect, Fiber } from "effect";
import { describe, expect, it } from "vitest";
import { type Lock, LockBusy, type LockHolder, readText, takeLock } from "./files.ts";
import { withLock } from "./lock.ts";
import { tempDir } from "./test/context.ts";

const take = (lockFile: string, command: string): Promise<Lock> =>
	Effect.runPromise(takeLock(lockFile, command));

const busy = (holder: LockHolder | undefined) =>
	fail("conflict", `Held by ${holder?.command}.`, "Wait for it.");

/** A lock file's contents, naming process `pid` running `command` since `since` (ms). */
const lockOf = (pid: number, command: string, since: number): string =>
	JSON.stringify({ pid, command, since: new Date(since).toISOString() });

describe("takeLock", () => {
	it("should take over a lock whose process is gone", async () => {
		// GIVEN a lock file left by a process that no longer exists
		const lockFile = join(tempDir(), "post.json.lock");
		writeFileSync(
			lockFile,
			JSON.stringify({ pid: 999_999, command: "gone", since: new Date().toISOString() }),
		);

		// WHEN the lock is asked for
		const lock = await take(lockFile, "test");

		// THEN it is granted
		expect(JSON.parse(readFileSync(lockFile, "utf8")).command).toBe("test");
		lock.release();
	});

	it("should take over a lock taken before the machine last started", async () => {
		// GIVEN a lock naming this (running) process, but dated years ago, as after a reboot
		// that gave its pid to another program
		const lockFile = join(tempDir(), "post.json.lock");
		writeFileSync(
			lockFile,
			JSON.stringify({ pid: process.pid, command: "old", since: "2001-01-01T00:00:00.000Z" }),
		);

		// WHEN the lock is asked for
		const lock = await take(lockFile, "test");

		// THEN it is granted instead of waiting for a command that no longer exists
		expect(JSON.parse(readFileSync(lockFile, "utf8")).command).toBe("test");
		lock.release();
	});

	it("should keep a live lock taken just before the machine's clock was corrected", async () => {
		// GIVEN a lock this running process took, dated a little before the computed start of the
		// machine, as a clock corrected forward after the lock was taken would make it look
		const lockFile = join(tempDir(), "post.json.lock");
		const boot = Date.now() - uptime() * 1000;
		writeFileSync(
			lockFile,
			JSON.stringify({
				pid: process.pid,
				command: "live",
				since: new Date(boot - 60_000).toISOString(),
			}),
		);

		// WHEN another command tries to take it
		const error = await Effect.runPromise(Effect.flip(takeLock(lockFile, "second")));

		// THEN the live holder keeps it
		expect(error instanceof LockBusy && error.holder?.command).toBe("live");
	});

	it("should take over an empty lock file left by a crash", async () => {
		// GIVEN an empty lock file, last changed a minute ago
		const lockFile = join(tempDir(), "post.json.lock");
		writeFileSync(lockFile, "");
		const aMinuteAgo = new Date(Date.now() - 60_000);
		utimesSync(lockFile, aMinuteAgo, aMinuteAgo);

		// WHEN the lock is asked for
		const lock = await take(lockFile, "test");

		// THEN it is granted instead of waiting forever
		expect(JSON.parse(readFileSync(lockFile, "utf8")).command).toBe("test");
		lock.release();
	});

	it("should say who holds a live lock", async () => {
		// GIVEN a lock held by this process, which is still running
		const lockFile = join(tempDir(), "post.json.lock");
		const first = await take(lockFile, "first");

		// WHEN a second command tries to take it
		const error = await Effect.runPromise(Effect.flip(takeLock(lockFile, "second")));

		// THEN it is told which command holds it
		expect(error).toBeInstanceOf(LockBusy);
		expect(error instanceof LockBusy && error.holder?.command).toBe("first");
		first.release();
	});

	it("should grant the lock again once it's released", async () => {
		// GIVEN a lock that was taken and released
		const lockFile = join(tempDir(), "post.json.lock");
		(await take(lockFile, "first")).release();

		// WHEN another command asks for it
		const second = await take(lockFile, "second");

		// THEN it is granted
		expect(JSON.parse(readFileSync(lockFile, "utf8")).command).toBe("second");
		second.release();
	});

	it("should fail with a fix, not wait, when the lock's place holds a folder", async () => {
		// GIVEN a folder where the lock file goes
		const lockFile = join(tempDir(), "post.json.lock");
		mkdirSync(lockFile);

		// WHEN the lock is asked for
		const error = await Effect.runPromise(Effect.flip(takeLock(lockFile, "test")));

		// THEN it fails at once, naming the lock file
		expect(error._tag).toBe("ShortsError");
		expect(error._tag === "ShortsError" && error.fix).toContain(lockFile);
	});

	it("should leave alone a lock that another command took over", async () => {
		// GIVEN a lock this command took, which another command then replaced with its own
		const lockFile = join(tempDir(), "post.json.lock");
		const ours = await take(lockFile, "ours");
		const theirs = JSON.stringify({ pid: 1, command: "theirs", since: new Date().toISOString() });
		writeFileSync(lockFile, theirs);

		// WHEN this command releases its lock
		ours.release();

		// THEN the other command's lock is still there
		expect(readFileSync(lockFile, "utf8")).toBe(theirs);
	});
});

describe("withLock", () => {
	it("should say who holds the lock once the wait runs out", async () => {
		// GIVEN a lock held by another command
		const lockFile = join(tempDir(), "post.json.lock");
		const held = await take(lockFile, "other command");

		// WHEN a command waits for it for 200 ms
		const error = await Effect.runPromise(
			Effect.flip(withLock(lockFile, "test", busy, Effect.void, { waitMs: 200 })),
		);

		// THEN it gives up, naming the holder
		expect(error.message).toBe("Held by other command.");
		held.release();
	});

	it("should stop waiting at once when interrupted", async () => {
		// GIVEN a command waiting for a lock that another command holds
		const lockFile = join(tempDir(), "post.json.lock");
		const held = await take(lockFile, "other command");
		const waiting = Effect.runFork(withLock(lockFile, "test", busy, Effect.void));

		// WHEN it is interrupted, as Ctrl-C does
		const started = Date.now();
		await Effect.runPromise(Fiber.interrupt(waiting));

		// THEN it stops well before its 10 s wait would end
		expect(Date.now() - started).toBeLessThan(1_000);
		// AND the other command's lock is untouched
		expect(JSON.parse(readFileSync(lockFile, "utf8")).command).toBe("other command");
		held.release();
	});

	it("should take over a lock whose process number went to a program started after it", async () => {
		// GIVEN a lock taken ten minutes ago that names a running process, which started a minute ago
		const lockFile = join(tempDir(), "post.json.lock");
		writeFileSync(lockFile, lockOf(process.pid, "gone", Date.now() - 10 * 60_000));
		const processStartedAt = async () => new Date(Date.now() - 60_000);

		// WHEN a command asks for the lock
		const holder = await Effect.runPromise(
			withLock(
				lockFile,
				"test",
				busy,
				Effect.sync(() => JSON.parse(readFileSync(lockFile, "utf8")).command),
				{ processStartedAt },
			),
		);

		// THEN it takes the lock over instead of waiting for a command that no longer exists
		expect(holder).toBe("test");
	});

	it.each([
		["an hour before the lock was taken", -60 * 60_000],
		["30 seconds after it, within the clock's slack", 30_000],
	])("should keep a lock whose process started %s", async (_, startedAfterLock) => {
		// GIVEN a lock taken just now that names a running process, and when that process started
		const lockFile = join(tempDir(), "post.json.lock");
		const since = Date.now();
		writeFileSync(lockFile, lockOf(process.pid, "live", since));
		let asked = 0;
		const processStartedAt = async () => {
			asked += 1;
			return new Date(since + startedAfterLock);
		};

		// WHEN a command waits for it for 300 ms
		const error = await Effect.runPromise(
			Effect.flip(withLock(lockFile, "test", busy, Effect.void, { waitMs: 300, processStartedAt })),
		);

		// THEN it gives up, naming the holder
		expect(error.message).toBe("Held by live.");
		// AND it asked when the holder started only once, not on every try
		expect(asked).toBe(1);
	});

	it("should release the lock however the work ends", async () => {
		// GIVEN a command whose work fails while it holds the lock
		const lockFile = join(tempDir(), "post.json.lock");

		// WHEN it runs
		await Effect.runPromise(Effect.flip(withLock(lockFile, "test", busy, Effect.fail("failed"))));

		// THEN the lock is gone
		expect(existsSync(lockFile)).toBe(false);
	});
});

describe("readText", () => {
	it("should call a missing file not found, and anything else a failure with its own fix", async () => {
		// GIVEN a path with nothing at it, and one that is a folder
		const dir = tempDir();

		// WHEN each is read
		const missing = await Effect.runPromise(
			Effect.flip(readText(join(dir, "gone.json"), "Make it first.")),
		);
		const folder = await Effect.runPromise(Effect.flip(readText(dir, "Make it first.")));

		// THEN only the missing one says to make it
		expect(missing.code).toBe("not-found");
		expect(missing.fix).toBe("Make it first.");
		// AND the folder one says to check the path, since making it again won't help
		expect(folder.code).toBe("failed");
		expect(folder.fix).toContain(dir);
	});
});
