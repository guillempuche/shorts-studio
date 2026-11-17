import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { postDir, readPost } from "../post-store.ts";
import { testContext } from "../test/context.ts";
import { fakePorts, run, runFailure } from "../test/fakes.ts";
import { failurePastLockWait } from "../test/lock.ts";
import { type PostFields, seedPost } from "../test/posts.ts";
import { beatPlan } from "./beat.ts";

const SLUG = "2026-11-04-plan";
const MODE = { dryRun: false, confirmed: true } as const;

/** Beat 1's image request, sent and paid for, as `image generate` saves it before fetching. */
const SAVED_REQUEST = {
	provider: "fake-images",
	model: "fake-fast",
	requestId: "req-1",
	statusUrl: "memory://req-1/status",
	responseUrl: "memory://req-1",
	inputHash: "h1",
	seed: 1,
	ledgerId: "l1",
};

/** Music of 6 s, cut on a grid, and an old plan of two beats with prompts. */
const withOldPlan = (pending?: typeof SAVED_REQUEST): PostFields => ({
	audio: {
		file: "audio/audio.m4a",
		hash: "a",
		origin: "mine",
		kind: "music",
		durationSec: 6,
		source: "song.m4a",
	},
	beats: {
		inputHash: "old",
		items: [
			{ index: 0, start: 0, end: 3, text: "", prompt: "a red door" },
			{
				index: 1,
				start: 3,
				end: 6,
				text: "",
				prompt: "a blue sky",
				...(pending === undefined ? {} : { pending }),
			},
		],
	},
});

const plan = (ctx: ReturnType<typeof testContext>) =>
	beatPlan.run({ post: SLUG, byMoment: false, force: true }, ctx, MODE);

describe("beat plan", () => {
	it("should replace an old plan with --force", async () => {
		// GIVEN music and an old plan with prompts
		const ctx = testContext();
		await seedPost(ctx, SLUG, withOldPlan());

		// WHEN the beats are planned again with --force
		const result = await run(plan(ctx));

		// THEN the new beats have no prompts
		expect(result.skipped).toBe(false);
		expect(result.beats.every((b) => b.prompt === undefined)).toBe(true);
	});

	it("should refuse to replace a plan while a beat's image is paid for and not fetched", async () => {
		// GIVEN an old plan whose beat 1 has a request sent and saved, and not fetched yet
		const ctx = testContext();
		await seedPost(ctx, SLUG, withOldPlan(SAVED_REQUEST));

		// WHEN the beats are planned again with --force
		const error = await runFailure(plan(ctx));

		// THEN it fails with conflict, naming beat 1, and offers fetching it first
		expect(error.code).toBe("conflict");
		expect(error.message).toContain("Beat 1 has a request already paid for");
		expect(error.fix).toContain(`Run image generate --post ${SLUG} --beat 1 --model fake-fast`);
		// AND the old plan and its saved request stay
		const beats = (await Effect.runPromise(readPost(ctx, SLUG))).beats;
		expect(beats?.inputHash).toBe("old");
		expect(beats?.items[1]?.pending).toEqual(SAVED_REQUEST);
	});

	it("should wait while image generate runs on the post", async () => {
		// GIVEN music, an old plan, and a running image generate holding the post's images
		const ctx = testContext();
		await seedPost(ctx, SLUG, withOldPlan());
		const lockFile = join(postDir(ctx, SLUG), "images.lock");
		// Taken now, not at the test clock's date: a lock from before the machine started is stale.
		writeFileSync(
			lockFile,
			JSON.stringify({
				pid: process.pid,
				command: "image generate",
				since: new Date().toISOString(),
			}),
		);

		// WHEN the beats are planned again, and the lock stays busy past the wait
		const error = await failurePastLockWait(plan(ctx).pipe(Effect.provide(fakePorts())));

		// THEN it fails with conflict, naming image generate, and the old plan stays
		expect(error.code).toBe("conflict");
		expect(error.message).toContain('"image generate"');
		expect((await Effect.runPromise(readPost(ctx, SLUG))).beats?.inputHash).toBe("old");
	});
});
