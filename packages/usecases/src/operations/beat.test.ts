import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { planInputHash, recutInputHash } from "../freshness.ts";
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

	it("should record what the beats were cut from", async () => {
		// GIVEN music and an old plan
		const ctx = testContext();
		await seedPost(ctx, SLUG, withOldPlan());

		// WHEN the beats are planned again
		await run(plan(ctx));

		// THEN post.json records the audio's plan hash they were cut from
		const post = await Effect.runPromise(readPost(ctx, SLUG));
		expect(post.beats?.sourceHash).toBe(planInputHash(post));
		expect(post.beats?.sourceHash).toBeDefined();
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

describe("beat plan, against the current transcript", () => {
	const SPEECH = "2026-11-04-speech";
	const speech = {
		file: "audio/audio.m4a",
		hash: "a2",
		origin: "mine" as const,
		kind: "speech" as const,
		durationSec: 4,
		source: "voice.m4a",
	};
	const transcript = (fields: { audioHash: string; hash?: string }) => ({
		file: "transcript.json",
		hash: fields.hash ?? "t1",
		inputHash: "ti",
		provider: "fake-transcriber",
		model: "fake-whisper",
		language: "en",
		audioHash: fields.audioHash,
	});
	const items = [
		{ index: 0, start: 0, end: 2, text: "one", moment: "hook" as const, prompt: "a red door" },
		{ index: 1, start: 2, end: 4, text: "two", moment: "payoff" as const, prompt: "a blue sky" },
	];
	/** Speech whose beats were cut from transcript t1 of audio a2, plainly or re-cut by moment. */
	const planned = (
		fields: { transcriptHash?: string; audioHash?: string; recut?: boolean } = {},
	) => {
		const cutFrom = { audio: speech, transcript: transcript({ audioHash: "a2" }) };
		const source = planInputHash({
			manifestVersion: 1,
			slug: SPEECH,
			createdAt: "",
			revision: 1,
			...cutFrom,
		}) as string;
		return {
			audio: speech,
			transcript: transcript({
				audioHash: fields.audioHash ?? "a2",
				hash: fields.transcriptHash ?? "t1",
			}),
			beats: {
				inputHash: fields.recut ? recutInputHash(source, items) : source,
				sourceHash: source,
				items,
			},
		};
	};
	const planSpeech = (
		ctx: ReturnType<typeof testContext>,
		fields: { byMoment?: boolean; force?: boolean } = {},
	) =>
		beatPlan.run(
			{ post: SPEECH, byMoment: fields.byMoment ?? false, force: fields.force ?? false },
			ctx,
			MODE,
		);
	const revisionOf = async (ctx: ReturnType<typeof testContext>) =>
		(await Effect.runPromise(readPost(ctx, SPEECH))).revision;

	it("should refuse to plan from a transcript of other audio, naming audio transcribe", async () => {
		// GIVEN new audio imported after the transcript was made
		const ctx = testContext();
		await seedPost(ctx, SPEECH, planned({ audioHash: "a1" }));
		const before = await revisionOf(ctx);

		// WHEN the beats are planned
		const error = await runFailure(planSpeech(ctx, { force: true }));

		// THEN it fails with stale, naming audio transcribe, and nothing changes
		expect(error.code).toBe("stale");
		expect(error.fix).toContain(`audio transcribe --post ${SPEECH} --dry-run`);
		expect(await revisionOf(ctx)).toBe(before);
	});

	it("should keep a re-cut by moment when planned plainly", async () => {
		// GIVEN beats re-cut by moment from the current transcript
		const ctx = testContext();
		await seedPost(ctx, SPEECH, planned({ recut: true }));
		const before = await revisionOf(ctx);

		// WHEN the beats are planned without --by-moment
		const result = await run(planSpeech(ctx));

		// THEN the plan is up to date, and every beat and prompt is kept
		expect(result.skipped).toBe(true);
		expect(result.beats.map((b) => b.prompt)).toEqual(["a red door", "a blue sky"]);
		expect(await revisionOf(ctx)).toBe(before);
	});

	it("should refuse beats with prompts cut from an earlier transcript, counting what it drops", async () => {
		// GIVEN beats with two prompts, and the transcript made again with other words
		const ctx = testContext();
		await seedPost(ctx, SPEECH, planned({ transcriptHash: "t2" }));
		const before = await revisionOf(ctx);

		// WHEN the beats are planned without --force
		const error = await runFailure(planSpeech(ctx));

		// THEN it fails with stale, saying where they were cut from and how many prompts it drops
		expect(error.code).toBe("stale");
		expect(error.message).toContain("an earlier transcript");
		expect(error.message).toContain("2 prompts");
		expect(await revisionOf(ctx)).toBe(before);
	});

	it("should refuse to re-cut by moment beats cut from an earlier transcript", async () => {
		// GIVEN beats with moments, and the transcript made again with other words
		const ctx = testContext();
		await seedPost(ctx, SPEECH, planned({ transcriptHash: "t2" }));
		const before = await revisionOf(ctx);

		// WHEN they're re-cut by moment, even with --force
		const error = await runFailure(planSpeech(ctx, { byMoment: true, force: true }));

		// THEN it fails with stale, naming the plain plan, and nothing changes
		expect(error.code).toBe("stale");
		expect(error.fix).toContain(`beat plan --post ${SPEECH} --force`);
		expect(await revisionOf(ctx)).toBe(before);
	});
});
