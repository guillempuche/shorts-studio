import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Effect, Fiber } from "effect";
import { describe, expect, it, vi } from "vitest";
import type { Context } from "../context.ts";
import { daysNow } from "../days.ts";
import { readLedger, spent } from "../ledger.ts";
import { postDir, readPost, updatePost } from "../post-store.ts";
import { testContext } from "../test/context.ts";
import {
	type FakeImageMaker,
	fakeImageBytes,
	fakeImageMaker,
	fakePorts,
	run,
	runFailure,
} from "../test/fakes.ts";
import { approveAsIs, approvedAsIs, readyForImages, seedPost } from "../test/posts.ts";
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

const ledgerOf = (ctx: Context) => Effect.runPromise(readLedger(ctx));
const postOf = (ctx: Context) => Effect.runPromise(readPost(ctx, SLUG));

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
		expect(error.code).toBe("needs-confirmation");
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
		expect(error.code).toBe("needs-confirmation");
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
});
