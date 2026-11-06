import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Effect, Exit } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { ShortsError } from "../src/core/errors.ts";
import { acquireLock } from "../src/core/files.ts";
import { readLedger, release, reserve, settle, spent } from "../src/core/ledger.ts";
import { createPost, postDir, readPost, updatePost } from "../src/core/post-store.ts";
import { makeTestContext, type TestContext } from "./support/context.ts";

let ctx: TestContext;
afterEach(() => ctx?.cleanup());

const failure = (exit: Exit.Exit<unknown, unknown>): ShortsError | undefined => {
	if (!Exit.isFailure(exit)) return undefined;
	const error = Exit.findErrorOption(exit);
	return error._tag === "Some" && error.value instanceof ShortsError ? error.value : undefined;
};

describe("post store", () => {
	it("should bump the revision on every update", async () => {
		// GIVEN a new post
		ctx = makeTestContext();
		await Effect.runPromise(createPost(ctx, { slug: "2026-11-04-a", createdAt: "x" }));
		// WHEN it is updated twice
		await Effect.runPromise(
			updatePost(ctx, "2026-11-04-a", "test", (p) => Effect.succeed({ ...p, aiGenerated: true })),
		);
		const post = await Effect.runPromise(
			updatePost(ctx, "2026-11-04-a", "test", (p) => Effect.succeed(p)),
		);
		// THEN its revision counts the writes
		expect(post.revision).toBe(3);
	});

	it("should name every invalid field of a hand-edited manifest", async () => {
		// GIVEN a post.json with two wrong fields
		ctx = makeTestContext();
		await Effect.runPromise(createPost(ctx, { slug: "2026-11-04-b", createdAt: "x" }));
		writeFileSync(
			join(postDir(ctx, "2026-11-04-b"), "post.json"),
			JSON.stringify({ manifestVersion: 1, slug: 5, createdAt: "x", revision: "two" }),
		);
		// WHEN it is read
		const error = failure(await Effect.runPromiseExit(readPost(ctx, "2026-11-04-b")));
		// THEN the error points at both fields and says how to recover
		expect(error?.message).toContain('["slug"]');
		expect(error?.message).toContain('["revision"]');
		expect(error?.fix).toContain("hand edit");
	});

	it("should refuse a slug that isn't lowercase words and dashes", async () => {
		// GIVEN a context
		ctx = makeTestContext();
		// WHEN a post with spaces in its slug is read
		const error = failure(await Effect.runPromiseExit(readPost(ctx, "My Post")));
		// THEN it's a usage error
		expect(error?.code).toBe("usage");
	});
});

describe("locks", () => {
	it("should take over a lock whose process is gone", async () => {
		// GIVEN a lock file left by a process that no longer exists
		ctx = makeTestContext();
		await Effect.runPromise(createPost(ctx, { slug: "2026-11-04-c", createdAt: "x" }));
		const lockFile = join(postDir(ctx, "2026-11-04-c"), "post.json.lock");
		writeFileSync(lockFile, JSON.stringify({ pid: 999_999, command: "gone", since: "x" }));
		// WHEN the lock is requested
		const lock = await acquireLock(lockFile, "test", 200);
		// THEN it is granted
		expect("release" in lock).toBe(true);
	});

	it("should report who holds a live lock once the wait runs out", async () => {
		// GIVEN a lock held by this (live) process
		ctx = makeTestContext();
		await Effect.runPromise(createPost(ctx, { slug: "2026-11-04-d", createdAt: "x" }));
		const lockFile = join(postDir(ctx, "2026-11-04-d"), "post.json.lock");
		const first = await acquireLock(lockFile, "first");
		// WHEN a second command asks for it with a short wait
		const second = await acquireLock(lockFile, "second", 200);
		// THEN it is told who holds it
		expect("heldBy" in second && second.heldBy.command).toBe("first");
		if ("release" in first) first.release();
	});
});

describe("ledger", () => {
	it("should refuse a call that would pass the daily cap", async () => {
		// GIVEN a $1 daily cap with $0.90 already reserved
		ctx = makeTestContext({ config: { caps: { dailyUsd: 1, postUsd: 10 } } });
		await Effect.runPromise(reserve(ctx, { provider: "fal", model: "m", post: "p", usd: 0.9 }));
		// WHEN a $0.20 call is reserved
		const error = failure(
			await Effect.runPromiseExit(
				reserve(ctx, { provider: "fal", model: "m", post: "p", usd: 0.2 }),
			),
		);
		// THEN it fails as over budget and says where the cap lives
		expect(error?.code).toBe("over-budget");
		expect(error?.fix).toContain("config.json");
	});

	it("should free a released reservation and count a settled one at its final amount", async () => {
		// GIVEN two reservations
		ctx = makeTestContext();
		const a = await Effect.runPromise(
			reserve(ctx, { provider: "fal", model: "m", post: "p", usd: 0.5 }),
		);
		const b = await Effect.runPromise(
			reserve(ctx, { provider: "fal", model: "m", post: "p", usd: 0.5 }),
		);
		// WHEN one is released and the other settled at $0.30
		await Effect.runPromise(release(ctx, a));
		await Effect.runPromise(settle(ctx, b, 0.3, "req-1"));
		// THEN today's spend is $0.30
		expect(spent(Effect.runSync(readLedger(ctx)), { day: "2026-11-04" })).toBeCloseTo(0.3);
	});

	it("should let only one of two simultaneous calls through when the cap fits one", async () => {
		// GIVEN a $1 cap and two $0.60 calls made at the same time
		ctx = makeTestContext({ config: { caps: { dailyUsd: 1, postUsd: 10 } } });
		const call = () =>
			Effect.runPromiseExit(reserve(ctx, { provider: "fal", model: "m", post: "p", usd: 0.6 }));
		// WHEN both reserve
		const results = await Promise.all([call(), call()]);
		// THEN exactly one succeeds
		expect(results.filter(Exit.isSuccess)).toHaveLength(1);
	});
});
