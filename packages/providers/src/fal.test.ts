import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { IMAGE_SIZE } from "@shorts-studio/domain/direction";
import { imageAmount, type Model, price } from "@shorts-studio/domain/models";
import { ImageMaker } from "@shorts-studio/usecases/ports";
import { imageMakerContract } from "@shorts-studio/usecases/test/image-maker.contract";
import { Effect } from "effect";
import { describe, expect, it, onTestFinished } from "vitest";
import { withEnv } from "./env.ts";
import { FAL_MODELS, falLayer } from "./fal.ts";
import { providerContext } from "./test/context.ts";
import { type FakeFalOptions, startFakeFal } from "./test/fal-server.ts";

/**
 * FAL's provider talking to a local fake of FAL's queue, with FAL_KEY set unless `secrets`
 * says otherwise.
 */
const withFakeFal = async (
	options: FakeFalOptions = {},
	secrets: Readonly<Record<string, string>> = { FAL_KEY: "test-key" },
) => {
	const fake = await startFakeFal(options);
	onTestFinished(() => fake.close());
	const ctx = providerContext({ endpoints: { fal: fake.url }, secrets });
	const fal = await Effect.runPromise(
		Effect.gen(function* () {
			return yield* ImageMaker;
		}).pipe(Effect.provide(withEnv(falLayer, ctx))),
	);
	return { fake, fal };
};

imageMakerContract("FAL", {
	make: async ({ answer, withKey }) => {
		const { fal } = await withFakeFal(
			answer === "ended"
				? { finalStatus: "FAILED" }
				: answer === "refused"
					? { submitStatus: 422 }
					: answer === "unknown"
						? { submitStatus: 502 }
						: {},
			withKey ? undefined : {},
		);
		return fal;
	},
});

const schnell = FAL_MODELS["flux-schnell"];

/** A server that only records the requests it gets, standing in for an address that isn't FAL. */
const startListener = async () => {
	const requests: Array<string | undefined> = [];
	const server = createServer((req, res) => {
		requests.push(req.headers.authorization);
		res.end("{}");
	});
	await new Promise<void>((listening) => server.listen(0, "127.0.0.1", () => listening()));
	const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	const close = () => new Promise<void>((closed) => server.close(() => closed()));
	onTestFinished(() => (server.listening ? close() : undefined));
	return { url, requests, close };
};

describe("FAL's own models", () => {
	it("should price each image by whole megapixels, as FAL bills them", async () => {
		// GIVEN FAL's models, and images of 1344×2400 (3.2 megapixels)
		const { fal } = await withFakeFal();
		const imagePrice = (name: string) => {
			const model = fal.models[name];
			return model === undefined ? undefined : price(model, imageAmount(model));
		};

		// WHEN one image is priced with each model
		// THEN each is billed as 4 megapixels
		expect(imagePrice("flux-schnell")?.units).toBe(4);
		expect(imagePrice("flux-schnell")?.usd).toBeCloseTo(4 * 0.003);
		expect(imagePrice("flux-dev")?.usd).toBeCloseTo(4 * 0.025);
	});
});

describe("FAL submit", () => {
	it("should send the prompt, seed, image size and model's options to its endpoint with the key", async () => {
		// GIVEN FAL and a key
		const { fake, fal } = await withFakeFal();

		// WHEN a flux-schnell image is submitted
		const request = await Effect.runPromise(fal.submit(schnell, "a red door", 7));

		// THEN FAL received the prompt, seed, image size and the model's steps on its endpoint,
		// with the key
		expect(fake.submits).toEqual([
			{
				endpoint: "fal-ai/flux/schnell",
				authorization: "Key test-key",
				prompt: "a red door",
				seed: 7,
				imageSize: IMAGE_SIZE,
				extra: {
					num_images: 1,
					num_inference_steps: 4,
					output_format: "jpeg",
					enable_safety_checker: true,
				},
			},
		]);
		// AND the request comes back with where to check on it
		expect(request).toEqual({
			requestId: "req-1",
			statusUrl: `${fake.url}/requests/req-1/status`,
			responseUrl: `${fake.url}/requests/req-1`,
		});
	});

	it("should leave a dropped connection as an unknown outcome, saying why it dropped", async () => {
		// GIVEN FAL at an address where nothing listens any more
		const gone = await startListener();
		await gone.close();
		const ctx = providerContext({ endpoints: { fal: gone.url }, secrets: { FAL_KEY: "test-key" } });
		const fal = await Effect.runPromise(
			Effect.gen(function* () {
				return yield* ImageMaker;
			}).pipe(Effect.provide(withEnv(falLayer, ctx))),
		);

		// WHEN an image is submitted
		const error = await Effect.runPromise(Effect.flip(fal.submit(schnell, "a red door", 7)));

		// THEN it is a provider failure, not a refusal
		expect(error.code).toBe("provider");
		expect(error.reason._tag).toBe("ProviderFailed");
		// AND it says why, so "check your connection" has something to go on
		expect(error.message).toContain("ECONNREFUSED");
	});

	it("should fail with missing-key, before sending anything, when FAL_KEY isn't set", async () => {
		// GIVEN FAL and no key
		const { fake, fal } = await withFakeFal({}, {});

		// WHEN an image is submitted
		const error = await Effect.runPromise(Effect.flip(fal.submit(schnell, "a red door", 7)));

		// THEN it says FAL_KEY isn't set
		expect(error.code).toBe("missing-key");
		expect(error.message).toContain("FAL_KEY");
		// AND nothing reached FAL
		expect(fake.submits).toHaveLength(0);
	});

	it("should send a model it doesn't ship to that model's endpoint, with its options", async () => {
		// GIVEN FAL, and a model added in config.json, with options of its own
		const { fake, fal } = await withFakeFal();
		const added: Model = {
			provider: "fal",
			job: "image",
			endpoint: "fal-ai/flux-pro/v1.1",
			billedBy: "megapixel",
			usdPerUnit: 0.04,
			roundUp: true,
			priceChecked: "2026-11-07",
			options: { safety_tolerance: "2" },
		};

		// WHEN an image is submitted with it
		await Effect.runPromise(fal.submit(added, "a red door", 7));

		// THEN FAL received it on that model's endpoint, with its options and no other model's
		expect(fake.submits[0]?.endpoint).toBe("fal-ai/flux-pro/v1.1");
		expect(fake.submits[0]?.extra["safety_tolerance"]).toBe("2");
		expect(fake.submits[0]?.extra).not.toHaveProperty("num_inference_steps");
	});

	it("should send the size, count, seed and prompt the estimate used, whatever a model's options say", async () => {
		// GIVEN FAL, and a model added in config.json whose options ask for four landscape images
		// of another prompt and seed
		const { fake, fal } = await withFakeFal();
		const greedy: Model = {
			...schnell,
			options: {
				num_images: 4,
				image_size: "landscape_16_9",
				seed: 1,
				prompt: "something else",
				output_format: "png",
			},
		};

		// WHEN an image is submitted with it
		await Effect.runPromise(fal.submit(greedy, "a red door", 7));

		// THEN FAL was asked for the one image, size, seed and prompt the estimate was made for
		expect(fake.submits[0]).toMatchObject({
			prompt: "a red door",
			seed: 7,
			imageSize: IMAGE_SIZE,
			extra: { num_images: 1 },
		});
		// AND options that don't change the bill still apply
		expect(fake.submits[0]?.extra["output_format"]).toBe("png");
	});
});

describe("FAL collect", () => {
	it("should wait until the request is done and return the image's bytes", async () => {
		// GIVEN a request FAL finishes after one more check
		const image = new Uint8Array([1, 2, 3, 4]);
		const { fal } = await withFakeFal({ pollsBeforeDone: 1, image: () => image });
		const request = await Effect.runPromise(fal.submit(schnell, "a red door", 7));

		// WHEN its image is collected
		const bytes = await Effect.runPromise(fal.collect(request));

		// THEN the image's bytes come back
		expect(bytes).toEqual(image);
	});

	it("should end the request with reason RequestEnded when FAL reports it failed", async () => {
		// GIVEN a request FAL marks as failed
		const { fal } = await withFakeFal({ finalStatus: "FAILED" });
		const request = await Effect.runPromise(fal.submit(schnell, "a red door", 7));

		// WHEN its image is collected
		const error = await Effect.runPromise(Effect.flip(fal.collect(request)));

		// THEN the reason tells the use case that waiting again won't help
		expect(error.reason._tag).toBe("RequestEnded");
		expect(error.code).toBe("provider");
		expect(error.message).toContain("FAILED");
	});

	it("should leave a 4xx while checking on a request as an unknown outcome, with the HTTP status", async () => {
		// GIVEN a request FAL took on, whose status address FAL no longer knows
		const { fake, fal } = await withFakeFal();
		const request = { requestId: "req-9", statusUrl: `${fake.url}/nope`, responseUrl: fake.url };

		// WHEN its image is collected
		const error = await Effect.runPromise(Effect.flip(fal.collect(request)));

		// THEN it is a provider failure but not a refusal: FAL took the job on, so it may have
		// billed it, and the reservation must stay counted
		expect(error.code).toBe("provider");
		expect(error.reason._tag).toBe("ProviderFailed");
		// AND it names the HTTP status and the method
		expect(error.message).toContain("HTTP 404 from GET");
	});

	it("should send the key only to FAL, even when post.json names another address", async () => {
		// GIVEN FAL, and a saved request whose status address a hand edit pointed elsewhere
		const { fake, fal } = await withFakeFal();
		const elsewhere = await startListener();
		const request = {
			requestId: "req-1",
			statusUrl: `${elsewhere.url}/requests/req-1/status`,
			responseUrl: `${fake.url}/requests/req-1`,
		};

		// WHEN its image is collected
		const error = await Effect.runPromise(Effect.flip(fal.collect(request)));

		// THEN it fails as a usage error naming the address
		expect(error.code).toBe("usage");
		expect(error.message).toContain(elsewhere.url);
		// AND nothing, and so no key, was sent to that address
		expect(elsewhere.requests).toHaveLength(0);
	});

	it("should fail with missing-key when FAL_KEY isn't set", async () => {
		// GIVEN a request saved earlier, and no key now
		const { fake, fal } = await withFakeFal({}, {});
		const request = {
			requestId: "req-1",
			statusUrl: `${fake.url}/requests/req-1/status`,
			responseUrl: `${fake.url}/requests/req-1`,
		};

		// WHEN its image is collected
		const error = await Effect.runPromise(Effect.flip(fal.collect(request)));

		// THEN it says FAL_KEY isn't set
		expect(error.code).toBe("missing-key");
	});
});
