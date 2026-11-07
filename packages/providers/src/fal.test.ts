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
			answer === "ended" ? { finalStatus: "FAILED" } : {},
			withKey ? undefined : {},
		);
		return fal;
	},
});

const schnell = FAL_MODELS["flux-schnell"];

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

	it("should report an HTTP error from FAL as a provider failure", async () => {
		// GIVEN a request whose status address FAL doesn't know
		const { fake, fal } = await withFakeFal();
		const request = { requestId: "req-9", statusUrl: `${fake.url}/nope`, responseUrl: fake.url };

		// WHEN its image is collected
		const error = await Effect.runPromise(Effect.flip(fal.collect(request)));

		// THEN it is a provider failure with the HTTP status, which running again may fix
		expect(error.code).toBe("provider");
		expect(error.reason._tag).toBe("ProviderFailed");
		expect(error.message).toContain("HTTP 404");
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
