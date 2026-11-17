import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it, vi } from "vitest";
import type { Context } from "../context.ts";
import { daysNow } from "../days.ts";
import { readLedger, spent } from "../ledger.ts";
import { postDir, readPost, updatePost } from "../post-store.ts";
import { BROKEN_CONFIG, testContext } from "../test/context.ts";
import {
	type FakeImageMaker,
	fakeImageBytes,
	fakeImageMaker,
	fakePorts,
	run,
	runFailure,
} from "../test/fakes.ts";
import { failurePastLockWait } from "../test/lock.ts";
import { approveAsIs, approvedAsIs, readyForImages, seedPost } from "../test/posts.ts";
import { expectValidStep } from "../test/steps.ts";
import { imageGenerate } from "./image.ts";
import { imageImport } from "./image-import.ts";

const SLUG = "2026-11-04-spend";

/** A post ready for images (approved script, two beats with prompts) and an image provider. */
const ready = async (ctx: Context = testContext(), maker: FakeImageMaker = fakeImageMaker()) => {
	await seedPost(ctx, SLUG, readyForImages());
	return { ctx, maker, ports: fakePorts({ imageMaker: maker }) };
};

const generate = (
	ctx: Context,
	input: { readonly beat?: string; readonly reroll?: boolean; readonly model?: string } = {},
	dryRun = false,
) =>
	imageGenerate.run(
		{ post: SLUG, beat: input.beat, reroll: input.reroll ?? false, model: input.model },
		ctx,
		{ dryRun, confirmed: true },
	);

/** A real run without the CLI's `--yes`, as the CLI runs one whose dry run estimated $0. */
const generateUnconfirmed = (ctx: Context, beat?: string) =>
	imageGenerate.run({ post: SLUG, beat, reroll: false, model: undefined }, ctx, {
		dryRun: false,
		confirmed: false,
	});

const ledgerOf = (ctx: Context) => Effect.runPromise(readLedger(ctx));
const postOf = (ctx: Context) => Effect.runPromise(readPost(ctx, SLUG));

/**
 * Sends `beat`'s request, then cuts the run short while it waits for the image, so the request
 * is saved in post.json and paid for, but not fetched.
 */
const leaveRequestSaved = async (
	ctx: Context,
	maker: FakeImageMaker,
	ports: ReturnType<typeof fakePorts>,
	beat: string,
	model?: string,
) => {
	maker.answer = "never";
	const waits = maker.waits;
	const fiber = Effect.runFork(
		generate(ctx, { beat, ...(model === undefined ? {} : { model }) }).pipe(Effect.provide(ports)),
	);
	await vi.waitUntil(() => maker.waits === waits + 1);
	await Effect.runPromise(Fiber.interrupt(fiber));
	maker.answer = "image";
};

/** `maker`, recording each submit (by prompt) and each collect (by request), in order. */
const recordingCalls = (maker: FakeImageMaker) => {
	const calls: Array<string> = [];
	const recording: FakeImageMaker = {
		...maker,
		submit: (model, prompt, seed) =>
			Effect.suspend(() => {
				calls.push(`submit ${prompt}`);
				return maker.submit(model, prompt, seed);
			}),
		collect: (request) =>
			Effect.suspend(() => {
				calls.push(`collect ${request.requestId}`);
				return maker.collect(request);
			}),
	};
	return { calls, ports: fakePorts({ imageMaker: recording }) };
};

/** Gives beat 0 a new prompt after its request was sent, and approves the post as it stands. */
const changeFirstPrompt = async (ctx: Context, prompt: string) => {
	await Effect.runPromise(
		updatePost(ctx, SLUG, "test", (post) =>
			Effect.succeed({
				...post,
				...(post.beats && {
					beats: {
						...post.beats,
						items: post.beats.items.map((b) => (b.index === 0 ? { ...b, prompt } : b)),
					},
				}),
			}),
		),
	);
	await approveAsIs(ctx, SLUG);
};

/** An approved script and four beats with prompts and no images. */
const fourBeats = () =>
	approvedAsIs({
		script: { file: "script.md", hash: "s" },
		beats: {
			inputHash: "b",
			items: ["a red door", "a blue sky", "a green field", "a grey wall"].map((prompt, index) => ({
				index,
				start: index * 2,
				end: index * 2 + 2,
				text: `beat ${index}`,
				prompt,
			})),
		},
	});

/** Damages the ledger while a paid call runs, so the call's ledger line can't be closed. */
const damageLedger = (ctx: Context) =>
	Effect.sync(() => appendFileSync(join(ctx.paths.data, "ledger.jsonl"), "not json\n"));

describe("image generate", () => {
	it("should keep an image made by an earlier version up to date, so it isn't paid for again", async () => {
		// GIVEN beat 0's image, saved with the input hash earlier versions wrote for its prompt,
		// model, seed 7 and image size
		const ctx = testContext();
		await seedPost(
			ctx,
			SLUG,
			approvedAsIs({
				...readyForImages(),
				beats: {
					inputHash: "b",
					items: [
						{
							index: 0,
							start: 0,
							end: 2,
							text: "one",
							prompt: "a red door",
							seed: 7,
							image: {
								file: "images/beat-00.jpg",
								hash: "i0",
								inputHash: "ad97fbe67d3945f02a672cefa4b98e8664c70201bf82b3e2a8f5e5c854345822",
								provider: "fake-images",
								model: "fake-fast",
								seed: 7,
								source: "generated",
							},
						},
					],
				},
			}),
		);
		const maker = fakeImageMaker();

		// WHEN images are generated
		await run(generate(ctx), fakePorts({ imageMaker: maker }));

		// THEN nothing is sent to the provider
		expect(maker.submits).toHaveLength(0);
	});

	it("should pay once per beat and nothing on a re-run", async () => {
		// GIVEN a post ready for images
		const { ctx, maker, ports } = await ready();

		// WHEN images are generated twice
		await run(generate(ctx), ports);
		const second = await run(generate(ctx), ports);

		// THEN the provider got one request per beat
		expect(maker.submits.map((s) => s.prompt)).toEqual(["a red door", "a blue sky"]);
		// AND every beat's image is saved in the post folder
		const post = await postOf(ctx);
		for (const beat of post.beats?.items ?? []) {
			const file = beat.image?.file ?? "";
			const sent = maker.submits.find((s) => s.prompt === beat.prompt);
			expect(readFileSync(join(postDir(ctx, SLUG), file))).toEqual(
				Buffer.from(fakeImageBytes(sent?.prompt ?? "", sent?.seed ?? 0)),
			);
		}
		// AND the second run skipped both beats
		expect(second.planned.map((p) => p.action)).toEqual(["skip", "skip"]);
	});

	it("should spend nothing on a dry run", async () => {
		// GIVEN a post ready for images
		const { ctx, maker, ports } = await ready();

		// WHEN a dry run is asked for
		const result = await run(generate(ctx, {}, true), ports);

		// THEN it plans two images with an estimated cost
		expect(result.planned.filter((p) => p.action === "generate")).toHaveLength(2);
		expect(result.estimateUsd).toBeCloseTo(0.02);
		// AND nothing reached the provider or the ledger
		expect(maker.submits).toHaveLength(0);
		expect(await ledgerOf(ctx)).toHaveLength(0);
	});

	it("should resume a request cut short instead of paying for it again", async () => {
		// GIVEN a post ready for images, and a provider that doesn't answer yet
		const { ctx, maker, ports } = await ready();
		maker.answer = "never";

		// WHEN the run is interrupted while it waits for beat 0
		const fiber = Effect.runFork(generate(ctx, { beat: "0" }).pipe(Effect.provide(ports)));
		await vi.waitUntil(() => maker.waits === 1);
		await Effect.runPromise(Fiber.interrupt(fiber));
		const pending = (await postOf(ctx)).beats?.items[0]?.pending;
		// AND it runs again once the provider has the image
		maker.answer = "image";
		await run(generate(ctx, { beat: "0" }), ports);

		// THEN the request was saved before waiting
		expect(pending?.requestId).toBe("req-1");
		// AND it was picked up again and paid for once
		expect(maker.submits).toHaveLength(1);
		const beat = (await postOf(ctx)).beats?.items[0];
		expect(beat?.image).toBeDefined();
		expect(beat?.pending).toBeUndefined();
		expect((await ledgerOf(ctx)).filter((e) => e.type === "reserve")).toHaveLength(1);
	});

	it("should save a request the provider was still answering when the run was interrupted", async () => {
		// GIVEN a post ready for images, and a provider slow to answer a submit
		const { ctx, maker, ports } = await ready();
		maker.answer = "held";

		// WHEN the run is interrupted while beat 0's request is being sent
		const fiber = Effect.runFork(generate(ctx, { beat: "0" }).pipe(Effect.provide(ports)));
		await vi.waitUntil(() => maker.held === 1);
		const stopped = Effect.runPromise(Fiber.interrupt(fiber));
		// AND the provider answers after all
		maker.letGo();
		await stopped;
		// AND it runs again once the provider has the image
		maker.answer = "image";
		await run(generate(ctx, { beat: "0" }), ports);

		// THEN the request was resumed, not sent again
		expect(maker.submits).toHaveLength(1);
		expect((await postOf(ctx)).beats?.items[0]?.image).toBeDefined();
		expect((await ledgerOf(ctx)).filter((e) => e.type === "reserve")).toHaveLength(1);
	});

	it("should settle a resumed request at the price it was reserved at, after a price change", async () => {
		// GIVEN beat 0's request sent at fake-fast's $0.01, and cut short while it waited
		const { ctx, maker, ports } = await ready();
		maker.answer = "never";
		const fiber = Effect.runFork(generate(ctx, { beat: "0" }).pipe(Effect.provide(ports)));
		await vi.waitUntil(() => maker.waits === 1);
		await Effect.runPromise(Fiber.interrupt(fiber));
		// AND fake-fast's price raised to $0.50 in config.json since
		const later = {
			...ctx,
			config: { models: { "fake-fast": { usdPerUnit: 0.5, priceChecked: "2026-11-07" } } },
		};

		// WHEN the run is resumed and the image arrives
		maker.answer = "image";
		await run(generate(later, { beat: "0" }), ports);

		// THEN the call settles at the $0.01 it reserved
		const entries = await ledgerOf(ctx);
		expect(entries.find((e) => e.type === "settle")?.usd).toBeCloseTo(0.01);
		expect(spent(entries, { post: SLUG })).toBeCloseTo(0.01);
	});

	it("should free the reservation when the provider refuses the request", async () => {
		// GIVEN a post ready for images, and a provider that answers no (an HTTP 4xx)
		const { ctx, maker, ports } = await ready();
		maker.answer = "refused";

		// WHEN beat 0's image is generated
		const error = await runFailure(generate(ctx, { beat: "0" }), ports);

		// THEN it fails as a provider error, and nothing stays counted
		expect(error.code).toBe("provider");
		const entries = await ledgerOf(ctx);
		expect(entries.map((e) => e.type)).toEqual(["reserve", "release"]);
		expect(spent(entries, { post: SLUG })).toBe(0);
	});

	it("should give up on a request the provider never answers, keeping its cost counted", async () => {
		// GIVEN a provider that takes the request but never answers it
		const { ctx, maker, ports } = await ready();
		maker.answer = "held";

		// WHEN beat 0 is generated and a minute passes
		const error = await Effect.runPromise(
			Effect.gen(function* () {
				const generating = yield* generate(ctx, { beat: "0" }).pipe(
					Effect.provide(ports),
					Effect.forkChild,
				);
				yield* Effect.promise(() => vi.waitUntil(() => maker.held === 1));
				yield* TestClock.adjust("60 seconds");
				return yield* Effect.flip(Fiber.join(generating));
			}).pipe(Effect.provide(TestClock.layer())),
		);

		// THEN the run fails, saying the provider didn't answer
		expect(error.code).toBe("provider");
		expect(error.message).toContain("didn't answer");
		// AND the fix says the cost stays counted, and that running it again pays again
		expect(error.fix).toContain("its cost stays counted");
		expect(error.fix).toContain("running it again pays for a new one");
		// AND the reservation stays counted, since the provider may have billed it
		const entries = await ledgerOf(ctx);
		expect(entries.map((entry) => entry.type)).toEqual(["reserve"]);
		expect(spent(entries, { post: SLUG })).toBeCloseTo(0.01);
		// AND no request was saved to resume, since none came back
		expect((await postOf(ctx)).beats?.items[0]?.pending).toBeUndefined();
	});

	it("should keep the reservation counted when sending gets no answer", async () => {
		// GIVEN a post ready for images, and a connection that drops before the provider answers
		const { ctx, maker, ports } = await ready();
		maker.answer = "dropped";

		// WHEN beat 0's image is generated
		const error = await runFailure(generate(ctx, { beat: "0" }), ports);

		// THEN it fails as a provider error
		expect(error.code).toBe("provider");
		// AND its $0.01 stays counted, since the provider may have taken the job on
		const entries = await ledgerOf(ctx);
		expect(entries.map((e) => e.type)).toEqual(["reserve"]);
		expect(spent(entries, { post: SLUG })).toBeCloseTo(0.01);
	});

	it("should keep an image it paid for when the ledger can't be closed", async () => {
		// GIVEN a post ready for images, and a ledger damaged while the provider makes the image
		const ctx = testContext();
		const base = fakeImageMaker();
		const maker = {
			...base,
			collect: (request: Parameters<typeof base.collect>[0]) =>
				damageLedger(ctx).pipe(Effect.andThen(base.collect(request))),
		};
		const { ports } = await ready(ctx, maker);

		// WHEN beat 0's image is generated
		await run(generate(ctx, { beat: "0" }), ports);

		// THEN the image is saved and recorded on the beat
		expect((await postOf(ctx)).beats?.items[0]?.image?.file).toBe("images/beat-00.jpg");
	});

	it("should regenerate only the rerolled beat, with a new seed", async () => {
		// GIVEN a post whose images exist
		const { ctx, maker, ports } = await ready();
		await run(generate(ctx), ports);
		const before = (await postOf(ctx)).beats?.items[1]?.seed;

		// WHEN beat 1 is rerolled
		await run(generate(ctx, { beat: "1", reroll: true }), ports);

		// THEN one more request was sent, for beat 1, with a different seed
		expect(maker.submits).toHaveLength(3);
		expect(maker.submits[2]?.prompt).toBe("a blue sky");
		expect(maker.submits[2]?.seed).not.toBe(before);
	});

	it("should let one run at a time make a post's images, so two runs pay once per beat", async () => {
		// GIVEN a post ready for images, and a provider slow to answer
		const { ctx, maker, ports } = await ready();
		maker.answer = "held";

		// WHEN a run sends both beats' requests, and a dry run and a second run start meanwhile
		const first = Effect.runFork(generate(ctx).pipe(Effect.provide(ports)));
		await vi.waitUntil(() => maker.held === 2);
		const dry = await run(generate(ctx, {}, true), ports);
		const second = await failurePastLockWait(generate(ctx).pipe(Effect.provide(ports)));
		maker.letGo();
		await Effect.runPromise(Fiber.join(first));

		// THEN the dry run planned both beats without waiting for the first run
		expect(dry.planned.map((p) => p.action)).toEqual(["generate", "generate"]);
		// AND the second run fails with conflict, naming the first run's command and the lock
		expect(second.code).toBe("conflict");
		expect(second.message).toContain('"image generate"');
		expect(second.message).toContain(join(postDir(ctx, SLUG), "images.lock"));
		// AND the provider got one request per beat
		expect(maker.submits.map((s) => s.prompt)).toEqual(["a red door", "a blue sky"]);
	});

	it("should fetch a saved request before it sends any new one", async () => {
		// GIVEN four beats without images, and beat 3's request sent and saved but not fetched
		const ctx = testContext();
		await seedPost(ctx, SLUG, fourBeats());
		const maker = fakeImageMaker();
		const ports = fakePorts({ imageMaker: maker });
		await leaveRequestSaved(ctx, maker, ports, "3");
		// AND a provider that records each call
		const { calls, ports: recorded } = recordingCalls(maker);

		// WHEN every beat's image is generated
		await run(generate(ctx), recorded);

		// THEN beat 3's request was fetched before any new request was sent
		const firstSubmit = calls.findIndex((call) => call.startsWith("submit"));
		expect(calls.indexOf("collect req-1")).toBeGreaterThanOrEqual(0);
		expect(calls.indexOf("collect req-1")).toBeLessThan(firstSubmit);
		// AND every beat has its image
		expect((await postOf(ctx)).beats?.items.every((b) => b.image !== undefined)).toBe(true);
	});

	it("should fetch and settle a request sent for an earlier prompt before sending the new one", async () => {
		// GIVEN beat 0's request sent and saved, and not fetched
		const { ctx, maker, ports } = await ready();
		await leaveRequestSaved(ctx, maker, ports, "0");
		// AND beat 0's prompt changed since, and the user approved it
		await changeFirstPrompt(ctx, "a green door");
		const { calls, ports: recorded } = recordingCalls(maker);

		// WHEN beat 0's image is planned, then generated
		const dry = await run(generate(ctx, { beat: "0" }, true), ports);
		await run(generate(ctx, { beat: "0" }), recorded);

		// THEN the dry run fetches the saved request and estimates only the new one
		expect(dry.planned).toEqual([
			{ beat: 0, action: "generate", estimateUsd: 0.01, fetchesSaved: true },
		]);
		// AND the run fetched the saved request before it sent the new one
		expect(calls).toEqual(["collect req-1", "submit a green door", "collect req-2"]);
		// AND the ledger holds two reservations, each settled once
		const entries = await ledgerOf(ctx);
		const reserved = entries.filter((e) => e.type === "reserve").map((e) => e.id);
		const settled = entries.filter((e) => e.type === "settle").map((e) => e.id);
		expect(reserved).toHaveLength(2);
		expect(settled).toEqual(reserved);
		// AND beat 0's image is the new prompt's, with no request left saved
		const beat = (await postOf(ctx)).beats?.items[0];
		expect(beat?.pending).toBeUndefined();
		expect(readFileSync(join(postDir(ctx, SLUG), beat?.image?.file ?? ""))).toEqual(
			Buffer.from(fakeImageBytes("a green door", maker.submits[1]?.seed ?? -1)),
		);
	});

	it("should fetch a request sent with another model when the beat is fetched without --model", async () => {
		// GIVEN beat 0's request sent with fake-fine, not the default model, and not fetched
		const { ctx, maker, ports } = await ready();
		await leaveRequestSaved(ctx, maker, ports, "0", "fake-fine");
		const { calls, ports: recorded } = recordingCalls(maker);

		// WHEN the free fetch runs: image generate --beat 0, without --model
		await run(generate(ctx, { beat: "0" }), recorded);

		// THEN the saved request is fetched first, and settled at fake-fine's $0.05
		expect(calls[0]).toBe("collect req-1");
		const entries = await ledgerOf(ctx);
		const first = entries.find((e) => e.type === "reserve")?.id;
		expect(entries.find((e) => e.type === "settle" && e.id === first)?.usd).toBeCloseTo(0.05);
		// AND only then does the default model, which has no image yet, get a new request
		expect(maker.submits.map((s) => s.endpoint)).toEqual(["fake/fine", "fake/fast"]);
	});

	it("should refuse a beat whose saved request another image provider holds, sending nothing", async () => {
		// GIVEN beat 0's request saved and not fetched, from an image provider no longer in use
		const { ctx, maker, ports } = await ready();
		await leaveRequestSaved(ctx, maker, ports, "0");
		await Effect.runPromise(
			updatePost(ctx, SLUG, "test", (post) =>
				Effect.succeed({
					...post,
					...(post.beats && {
						beats: {
							...post.beats,
							items: post.beats.items.map((b) =>
								b.pending === undefined
									? b
									: { ...b, pending: { ...b.pending, provider: "other" } },
							),
						},
					}),
				}),
			),
		);

		// WHEN beat 0's image is generated
		const error = await runFailure(generate(ctx, { beat: "0" }), ports);

		// THEN it fails with conflict, naming the provider to use, and sends nothing
		expect(error.code).toBe("conflict");
		expect(error.fix).toContain("image.provider to other");
		expect(maker.submits).toHaveLength(1);
		// AND the saved request stays
		expect((await postOf(ctx)).beats?.items[0]?.pending?.provider).toBe("other");
	});

	it("should refuse to reroll a beat whose request is paid for and not fetched, sending nothing", async () => {
		// GIVEN beat 1's request sent and saved, and not fetched
		const { ctx, maker, ports } = await ready();
		await leaveRequestSaved(ctx, maker, ports, "1");
		const before = (await postOf(ctx)).beats?.items[1];

		// WHEN beat 1 is rerolled
		const error = await runFailure(generate(ctx, { beat: "1", reroll: true }), ports);

		// THEN it fails with conflict, and nothing more was sent
		expect(error.code).toBe("conflict");
		expect(maker.submits).toHaveLength(1);
		// AND beat 1's saved request and seed are as they were
		const after = (await postOf(ctx)).beats?.items[1];
		expect(after?.pending).toEqual(before?.pending);
		expect(after?.seed).toBe(before?.seed);
		// AND the fix says to fetch it first, without --reroll
		expect(error.fix).toContain(
			`Run image generate --post ${SLUG} --beat 1 without --reroll first`,
		);
	});

	it("should keep the old seed when a reroll would pass a cap, so trying again plans the same seed", async () => {
		// GIVEN beat 0's image made at $0.01, under a daily cap of $0.015
		const ctx = testContext({ config: { caps: { dailyUsd: 0.015 } } });
		const { maker, ports } = await ready(ctx);
		await run(generate(ctx, { beat: "0" }), ports);
		const seed = (await postOf(ctx)).beats?.items[0]?.seed ?? -1;

		// WHEN beat 0 is rerolled, which would pass today's cap
		const error = await runFailure(generate(ctx, { beat: "0", reroll: true }), ports);

		// THEN it fails over the cap, and beat 0's seed is what it was
		expect(error.code).toBe("over-budget");
		expect((await postOf(ctx)).beats?.items[0]?.seed).toBe(seed);
		// AND once there's room, the reroll sends the seed after the old one, not the one after that
		await run(generate({ ...ctx, config: {} }, { beat: "0", reroll: true }), ports);
		expect(maker.submits.map((s) => s.seed)).toEqual([seed, seed + 1]);
		expect((await postOf(ctx)).beats?.items[0]?.seed).toBe(seed + 1);
	});

	it("should name a request paid for and not fetched when a cap stops the run, and offer to fetch it", async () => {
		// GIVEN beat 0's request sent and saved, and not fetched, under a per-post cap of $0.015
		const ctx = testContext({ config: { caps: { postUsd: 0.015 } } });
		const { maker, ports } = await ready(ctx);
		await leaveRequestSaved(ctx, maker, ports, "0");

		// WHEN beat 1 is generated, which would pass the per-post cap while beat 0 isn't fetched
		const error = await runFailure(generate(ctx, { beat: "1" }), ports);

		// THEN it fails over the cap
		expect(error.code).toBe("over-budget");
		// AND the message says no image was saved, and names beat 0 as paid for but not fetched
		expect(error.message).toContain("No image was saved before it stopped.");
		expect(error.message).toContain("Paid for but not fetched yet: beat 0.");
		// AND the fix offers fetching it, at no cost
		expect(error.fix).toContain(
			`Run image generate --post ${SLUG} --beat 0: it fetches the image already paid for, at no cost.`,
		);
	});

	it("should fetch a saved request before a cap stops the new ones, and say it saved it", async () => {
		// GIVEN beat 0's request sent and saved, and not fetched, under a per-post cap of $0.015
		const ctx = testContext({ config: { caps: { postUsd: 0.015 } } });
		const { maker, ports } = await ready(ctx);
		await leaveRequestSaved(ctx, maker, ports, "0");

		// WHEN every beat is generated, which would pass the per-post cap at beat 1
		const error = await runFailure(generate(ctx), ports);

		// THEN it fails over the cap, saying it saved beat 0, with nothing left to fetch
		expect(error.code).toBe("over-budget");
		expect(error.message).toContain("Saved before it stopped: beat 0.");
		expect(error.message).not.toContain("Paid for but not fetched");
		expect((await postOf(ctx)).beats?.items[0]?.image).toBeDefined();
	});

	it("should say it waits for the provider's answer when interrupted mid-send, then save the request", async () => {
		// GIVEN a post ready for images, a provider slow to answer a submit, and the run's log
		const lines: Array<string> = [];
		const ctx = testContext({ log: (line) => lines.push(line) });
		const { maker, ports } = await ready(ctx);
		maker.answer = "held";

		// WHEN the run is interrupted while beat 1's request is being sent
		const fiber = Effect.runFork(generate(ctx, { beat: "1" }).pipe(Effect.provide(ports)));
		await vi.waitUntil(() => maker.held === 1);
		let ended = false;
		const stopped = Effect.runPromise(Fiber.interrupt(fiber)).then(() => {
			ended = true;
		});

		// THEN the log names beat 1 and the wait, while the request is still being sent
		await vi.waitUntil(() =>
			lines.some((line) => line.includes("beat 1: waiting up to 60 seconds")),
		);
		expect(ended).toBe(false);
		// AND once the provider answers, the run ends with the request saved in post.json
		maker.letGo();
		await stopped;
		expect((await postOf(ctx)).beats?.items[1]?.pending?.requestId).toBe("req-1");
		expect((await ledgerOf(ctx)).filter((e) => e.type === "reserve")).toHaveLength(1);
	});

	it("should refuse to spend before the script is approved", async () => {
		// GIVEN a post whose script was edited after approval
		const { ctx, maker, ports } = await ready();
		await Effect.runPromise(
			updatePost(ctx, SLUG, "test", (post) =>
				Effect.succeed({ ...post, script: { file: "script.md", hash: "new", approvedHash: "s" } }),
			),
		);

		// WHEN images are generated
		const error = await runFailure(generate(ctx), ports);

		// THEN it stops before the provider, asking for the user's approval
		expect(error.code).toBe("needs-approval");
		expect(maker.submits).toHaveLength(0);
	});

	it("should refuse to spend when a prompt changed after the script was approved", async () => {
		// GIVEN a post ready for images, whose beat 1 got a new prompt after approval
		const { ctx, maker, ports } = await ready();
		await Effect.runPromise(
			updatePost(ctx, SLUG, "test", (post) =>
				Effect.succeed({
					...post,
					...(post.beats && {
						beats: {
							...post.beats,
							items: post.beats.items.map((b) =>
								b.index === 1 ? { ...b, prompt: "a burning house" } : b,
							),
						},
					}),
				}),
			),
		);

		// WHEN images are generated
		const error = await runFailure(generate(ctx), ports);

		// THEN nothing reaches the provider, and the user is asked to approve the new prompt
		expect(error.code).toBe("needs-approval");
		expect(error.message).toContain("prompt of beat 1");
		expect(error.fix).toContain("script approve");
		expect(maker.submits).toHaveLength(0);
	});

	it("should never send a beat that has no prompt, even when rerolled", async () => {
		// GIVEN beat 1 has an imported image and no prompt
		const { ctx, maker, ports } = await ready();
		await Effect.runPromise(
			updatePost(ctx, SLUG, "test", (post) =>
				Effect.succeed({
					...post,
					beats: {
						inputHash: "b",
						items: [
							{ index: 0, start: 0, end: 2, text: "one", prompt: "a red door" },
							{
								index: 1,
								start: 2,
								end: 4,
								text: "two",
								image: {
									file: "images/beat-01-imported.png",
									hash: "i",
									inputHash: "i",
									provider: "import",
									model: "none",
									seed: 0,
									source: "imported" as const,
								},
							},
						],
					},
				}),
			),
		);
		// AND the user approved the post as it now stands
		await approveAsIs(ctx, SLUG);

		// WHEN every beat is rerolled
		await run(generate(ctx, { reroll: true }), ports);

		// THEN only beat 0 was sent
		expect(maker.submits.map((s) => s.prompt)).toEqual(["a red door"]);
	});

	it("should keep an imported image when the other beats are generated", async () => {
		// GIVEN a post ready for images, with a Midjourney image imported for beat 0
		const { ctx, maker, ports } = await ready();
		const ownImage = join(ctx.paths.data, "mj.png");
		mkdirSync(ctx.paths.data, { recursive: true });
		writeFileSync(ownImage, "png");
		await run(
			imageImport.run({ post: SLUG, beat: 0, file: ownImage }, ctx, {
				dryRun: false,
				confirmed: true,
			}),
		);

		// WHEN images are generated
		await run(generate(ctx), ports);

		// THEN only beat 1 was sent
		expect(maker.submits.map((s) => s.prompt)).toEqual(["a blue sky"]);
		// AND beat 0 keeps the imported image
		expect((await postOf(ctx)).beats?.items[0]?.image?.source).toBe("imported");
	});

	it("should free the reservation when the provider ends the request", async () => {
		// GIVEN a provider that gives up on every request
		const { ctx, maker, ports } = await ready();
		maker.answer = "ended";

		// WHEN beat 0's image is generated
		const error = await runFailure(generate(ctx, { beat: "0" }), ports);

		// THEN it fails as a provider failure that says to send a new request
		expect(error.code).toBe("provider");
		expect(error.fix).toBe(`Run image generate --post ${SLUG} --yes to send a new request.`);
		// AND nothing counts as spent and no request is left to resume
		expect(spent(await ledgerOf(ctx), { since: daysNow(ctx).startOfToday })).toBe(0);
		expect((await postOf(ctx)).beats?.items[0]?.pending).toBeUndefined();
	});

	it("should fail on a missing key before reserving anything", async () => {
		// GIVEN a provider that needs a key that isn't set
		const maker = fakeImageMaker({ keys: [{ env: "FAKE_IMAGES_KEY", keychain: "fake-images" }] });
		const { ctx, ports } = await ready(testContext(), maker);

		// WHEN images are generated
		const error = await runFailure(generate(ctx), ports);

		// THEN it says which key to set
		expect(error.code).toBe("missing-key");
		expect(error.message).toContain("FAKE_IMAGES_KEY");
		// AND nothing was reserved or sent
		expect(await ledgerOf(ctx)).toHaveLength(0);
		expect(maker.submits).toHaveLength(0);
	});

	it("should keep the seeds when --reroll stops on a missing key", async () => {
		// GIVEN a post ready for images, and a provider that needs a key that isn't set
		const maker = fakeImageMaker({ keys: [{ env: "FAKE_IMAGES_KEY", keychain: "fake-images" }] });
		const { ctx, ports } = await ready(testContext(), maker);
		const before = (await postOf(ctx)).beats?.items.map((b) => b.seed);

		// WHEN beat 0 is rerolled
		const error = await runFailure(generate(ctx, { beat: "0", reroll: true }), ports);

		// THEN it says which key to set
		expect(error.code).toBe("missing-key");
		// AND the seeds are as they were, so running it again with the key rerolls only once
		expect((await postOf(ctx)).beats?.items.map((b) => b.seed)).toEqual(before);
	});

	it("should point at config.json when the image provider offers no models", async () => {
		// GIVEN an image provider that offers no models, as one named wrongly in config.json does
		const maker = { ...fakeImageMaker(), provider: "nope", models: {}, defaultModel: "" };
		const { ctx, ports } = await ready(testContext(), maker);

		// WHEN images are generated
		const error = await runFailure(generate(ctx), ports);

		// THEN it names the provider and says where to fix it
		expect(error.code).toBe("usage");
		expect(error.message).toContain('"nope"');
		expect(error.fix).toContain("image.provider in config.json");
	});

	it("should refuse a model the provider doesn't offer, listing the ones it does", async () => {
		// GIVEN a post ready for images
		const { ctx, maker, ports } = await ready();

		// WHEN images are generated with an unknown model
		const error = await runFailure(generate(ctx, { model: "nope" }), ports);

		// THEN it is a usage error naming the provider's models
		expect(error.code).toBe("usage");
		expect(error.fix).toContain("fake-fast");
		expect(maker.submits).toHaveLength(0);
	});

	it("should generate with a model added in config.json, and reserve its price", async () => {
		// GIVEN a post ready for images, and config.json adding a model the provider doesn't ship,
		// at $0.04 per megapixel, rounded up
		const ctx = testContext({
			config: {
				models: {
					"fake-pro": {
						provider: "fake-images",
						job: "image",
						endpoint: "fake/pro",
						billedBy: "megapixel",
						usdPerUnit: 0.04,
						roundUp: true,
						priceChecked: "2026-11-07",
					},
				},
			},
		});
		const { maker, ports } = await ready(ctx);

		// WHEN beat 0's image is generated with that model
		const result = await run(generate(ctx, { beat: "0", model: "fake-pro" }), ports);

		// THEN the provider got the request on that model's endpoint
		expect(maker.submits.map((s) => s.endpoint)).toEqual(["fake/pro"]);
		// AND 4 megapixels at its price were reserved, under its name
		expect(result.estimateUsd).toBeCloseTo(0.16);
		const [reserved] = await ledgerOf(ctx);
		expect(reserved).toMatchObject({
			model: "fake-pro",
			unit: "megapixel",
			units: 4,
			usdPerUnit: 0.04,
		});
		expect(reserved?.usd).toBeCloseTo(0.16);
	});

	it("should price a built-in model at the price config.json gives it", async () => {
		// GIVEN a post ready for images, and config.json raising fake-fast's price to $0.03
		const ctx = testContext({
			config: { models: { "fake-fast": { usdPerUnit: 0.03, priceChecked: "2026-11-07" } } },
		});
		const { maker, ports } = await ready(ctx);

		// WHEN beat 0's image is generated with fake-fast
		const result = await run(generate(ctx, { beat: "0" }), ports);

		// THEN it is estimated and reserved at the new price
		expect(result.estimateUsd).toBeCloseTo(0.03);
		expect((await ledgerOf(ctx))[0]?.usd).toBeCloseTo(0.03);
		// AND the rest of the built-in model is kept: the request went to fake-fast's endpoint
		expect(maker.submits.map((s) => s.endpoint)).toEqual(["fake/fast"]);
	});

	it("should say what a model added in config.json is missing, before spending", async () => {
		// GIVEN a post ready for images, and config.json adding a model without an endpoint
		const ctx = testContext({
			config: {
				models: {
					"fake-pro": {
						provider: "fake-images",
						job: "image",
						billedBy: "image",
						usdPerUnit: 0.04,
						priceChecked: "2026-11-07",
					},
				},
			},
		});
		const { maker, ports } = await ready(ctx);

		// WHEN images are generated
		const error = await runFailure(generate(ctx), ports);

		// THEN it is a usage error naming the model and the missing field
		expect(error.code).toBe("usage");
		expect(error.message).toContain("models.fake-pro");
		expect(error.message).toContain("endpoint");
		expect(error.fix).toContain("config.json");
		// AND nothing was reserved or sent
		expect(await ledgerOf(ctx)).toHaveLength(0);
		expect(maker.submits).toHaveLength(0);
	});

	it("should add the brand's style to every prompt", async () => {
		// GIVEN a brand whose images end with a style
		const ctx = testContext({ brand: { imagePrompt: { suffix: " film grain " } } });
		const { maker, ports } = await ready(ctx);

		// WHEN beat 0's image is generated
		await run(generate(ctx, { beat: "0" }), ports);

		// THEN the prompt sent ends with the style
		expect(maker.submits.map((s) => s.prompt)).toEqual(["a red door, film grain"]);
	});

	it("should keep the seeds when a reroll is refused for a setting that can't be used", async () => {
		// GIVEN a post ready for images, and a setting that couldn't be used
		const ctx = testContext({
			settingsIssues: [BROKEN_CONFIG],
		});
		await seedPost(ctx, SLUG, readyForImages());
		const before = (await postOf(ctx)).beats?.items.map((b) => b.seed);

		// WHEN beat 1 is rerolled
		const error = await runFailure(generate(ctx, { beat: "1", reroll: true }), fakePorts());

		// THEN it is refused, and no seed changed
		expect(error.code).toBe("failed");
		expect((await postOf(ctx)).beats?.items.map((b) => b.seed)).toEqual(before);
	});
});

describe("image generate, when its dry run says the real run can't go ahead", () => {
	const KEY = { env: "FAKE_IMAGES_KEY", keychain: "fake-images" };

	it("should say a dry run without the key can't go ahead, naming the key, and leave it to the user", async () => {
		// GIVEN a post ready for images, and a provider whose key isn't set
		const maker = fakeImageMaker({ keys: [KEY] });
		const { ctx, ports } = await ready(testContext(), maker);

		// WHEN a dry run is asked for
		const result = await run(generate(ctx, {}, true), ports);

		// THEN it succeeds, saying the real run is stopped by the missing key, which it names
		expect(result.budget).toMatchObject({ fits: false, stoppedBy: "missing-key" });
		expect(result.budget?.why).toContain("FAKE_IMAGES_KEY");
		// AND its first step is the user's, naming the key, with no tool
		const [first] = result.nextSteps;
		expect(first).toMatchObject({ by: "user" });
		expect(first?.note).toContain("FAKE_IMAGES_KEY");
		expect(first?.tool).toBeUndefined();
		// AND nothing was sent or reserved
		expect(maker.submits).toHaveLength(0);
		expect(await ledgerOf(ctx)).toHaveLength(0);
	});

	it("should need no key for a dry run with nothing to send or fetch", async () => {
		// GIVEN both beats' images made with the key set
		const maker = fakeImageMaker({ keys: [KEY] });
		const { ctx, ports } = await ready(testContext({ secrets: { FAKE_IMAGES_KEY: "k" } }), maker);
		await run(generate(ctx), ports);

		// WHEN a dry run is asked for without the key
		const result = await run(generate({ ...ctx, secret: async () => undefined }, {}, true), ports);

		// THEN it fits, since the real run wouldn't call the provider
		expect(result.budget?.fits).toBe(true);
	});

	it("should leave a setting that can't be used to the user, then config_check to the agent", async () => {
		// GIVEN a post ready for images, and a config.json that couldn't be used
		const { ctx, ports } = await ready(testContext({ settingsIssues: [BROKEN_CONFIG] }));

		// WHEN a dry run is asked for
		const result = await run(generate(ctx, {}, true), ports);

		// THEN it's stopped by the setting
		expect(result.budget?.stoppedBy).toBe("settings");
		// AND its first step is the user's, naming config.json and the problem
		const [first, ...later] = result.nextSteps;
		expect(first?.by).toBe("user");
		expect(first?.note).toContain(
			'/data/config.json: captions.fontSize: Expected a number, got "big"',
		);
		// AND a later step is the agent's config_check
		expect(later).toContainEqual(expect.objectContaining({ by: "agent", tool: "config_check" }));
		for (const step of result.nextSteps) expectValidStep(step, step.cli ?? step.note ?? "");
	});

	it("should offer fetching the images already paid for, at no cost, after the user's call on a cap", async () => {
		// GIVEN beat 0's request saved and not fetched, under a daily cap of $0.015
		const ctx = testContext({ config: { caps: { dailyUsd: 0.015 } } });
		const { maker, ports } = await ready(ctx);
		await leaveRequestSaved(ctx, maker, ports, "0");

		// WHEN a dry run plans beat 1's new request, which would pass today's cap
		const result = await run(generate(ctx, {}, true), ports);

		// THEN its first step is the user's, naming the daily cap
		const [first, ...later] = result.nextSteps;
		expect(first?.by).toBe("user");
		expect(first?.note).toContain("caps.dailyUsd");
		// AND a later step is the agent's fetch of beat 0, which needs no --yes
		const fetch = later.find((step) => step.tool === "image_generate");
		expect(fetch).toMatchObject({ by: "agent", args: { post: SLUG, beat: "0" } });
		expect(fetch?.cli).toBe(`image generate --post ${SLUG} --beat 0`);
		expect(fetch?.note).toBe("fetches the image already paid for, at no cost");
		for (const step of result.nextSteps) expectValidStep(step, step.cli ?? step.note ?? "");
	});

	it("should not offer the free fetch while the key it needs is missing", async () => {
		// GIVEN beat 0's request saved and not fetched, and then the provider's key gone
		const { ctx, maker, ports } = await ready();
		await leaveRequestSaved(ctx, maker, ports, "0");
		const keyed = fakeImageMaker({ keys: [KEY] });

		// WHEN a dry run is asked for
		const result = await run(generate(ctx, {}, true), fakePorts({ imageMaker: keyed }));

		// THEN the only step is the user's, setting the key
		expect(result.budget?.stoppedBy).toBe("missing-key");
		expect(result.nextSteps).toHaveLength(1);
		expect(result.nextSteps[0]?.by).toBe("user");
	});

	it("should make a real run with nothing to pay for the next step, without --yes", async () => {
		// GIVEN beat 0's request saved and not fetched
		const { ctx, maker, ports } = await ready();
		await leaveRequestSaved(ctx, maker, ports, "0");

		// WHEN a dry run plans beat 0
		const result = await run(generate(ctx, { beat: "0" }, true), ports);

		// THEN it fits at $0, and the next step is the real run, which needs no --yes
		expect(result).toMatchObject({ estimateUsd: 0, budget: { fits: true } });
		expect(result.nextSteps[0]?.cli).toBe(`image generate --post ${SLUG} --beat 0`);
	});
});

describe("image generate, when what it pays for depends on the settings and keys", () => {
	it("should fetch saved requests next to a setting that can't be used, since it pays for nothing", async () => {
		// GIVEN beat 0's request saved and not fetched
		const { ctx, maker, ports } = await ready();
		await leaveRequestSaved(ctx, maker, ports, "0");
		const broken = { ...ctx, settingsIssues: [BROKEN_CONFIG] };

		// WHEN beat 0 is generated while a setting can't be used
		const result = await run(generate(broken, { beat: "0" }), ports);

		// THEN its image is fetched and saved, and nothing new was sent
		expect(result.estimateUsd).toBe(0);
		expect((await postOf(ctx)).beats?.items[0]?.image).toBeDefined();
		expect(maker.submits).toHaveLength(1);
		// AND a run that would pay for beat 1 is still refused
		const error = await runFailure(generate(broken, { beat: "1" }), ports);
		expect(error.code).toBe("failed");
		expect(maker.submits).toHaveLength(1);
	});

	it("should fetch saved requests without the CLI's --yes", async () => {
		// GIVEN beat 0's request saved and not fetched
		const { ctx, maker, ports } = await ready();
		await leaveRequestSaved(ctx, maker, ports, "0");

		// WHEN beat 0 is generated without confirmation
		await run(generateUnconfirmed(ctx, "0"), ports);

		// THEN its image is saved, and nothing new was sent
		expect((await postOf(ctx)).beats?.items[0]?.image).toBeDefined();
		expect(maker.submits).toHaveLength(1);
	});

	it("should send nothing without the CLI's --yes when the run would pay, as when the post changed after a $0 estimate", async () => {
		// GIVEN a post ready for images
		const { ctx, maker, ports } = await ready();

		// WHEN its images are generated without confirmation
		const error = await runFailure(generateUnconfirmed(ctx), ports);

		// THEN it asks for confirmation, and nothing was sent or reserved
		expect(error.code).toBe("needs-confirmation");
		expect(maker.submits).toHaveLength(0);
		expect(await ledgerOf(ctx)).toHaveLength(0);
	});
});
