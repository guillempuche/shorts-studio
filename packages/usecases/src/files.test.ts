import { utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { acquireLock } from "./files.ts";
import { tempDir } from "./test/context.ts";

describe("acquireLock", () => {
	it("should take over a lock whose process is gone", async () => {
		// GIVEN a lock file left by a process that no longer exists
		const lockFile = join(tempDir(), "post.json.lock");
		writeFileSync(lockFile, JSON.stringify({ pid: 999_999, command: "gone", since: "x" }));

		// WHEN the lock is asked for
		const lock = await acquireLock(lockFile, "test", 200);

		// THEN it is granted
		expect("release" in lock).toBe(true);
	});

	it("should take over an empty lock file left by a crash", async () => {
		// GIVEN an empty lock file, last changed a minute ago
		const lockFile = join(tempDir(), "post.json.lock");
		writeFileSync(lockFile, "");
		const aMinuteAgo = new Date(Date.now() - 60_000);
		utimesSync(lockFile, aMinuteAgo, aMinuteAgo);

		// WHEN the lock is asked for
		const lock = await acquireLock(lockFile, "test", 200);

		// THEN it is granted instead of waiting forever
		expect("release" in lock).toBe(true);
	});

	it("should say who holds a live lock once the wait runs out", async () => {
		// GIVEN a lock held by this process, which is still running
		const lockFile = join(tempDir(), "post.json.lock");
		const first = await acquireLock(lockFile, "first");

		// WHEN a second command asks for it with a short wait
		const second = await acquireLock(lockFile, "second", 200);

		// THEN it is told which command holds it
		expect("heldBy" in second && second.heldBy.command).toBe("first");
		if ("release" in first) first.release();
	});

	it("should grant the lock again once it's released", async () => {
		// GIVEN a lock that was taken and released
		const lockFile = join(tempDir(), "post.json.lock");
		const first = await acquireLock(lockFile, "first");
		if ("release" in first) first.release();

		// WHEN another command asks for it without waiting
		const second = await acquireLock(lockFile, "second", 0);

		// THEN it is granted
		expect("release" in second).toBe(true);
	});
});
