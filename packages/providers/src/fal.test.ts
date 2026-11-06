import { IMAGE_SIZE } from "@shorts-studio/domain/direction";
import { ImageMaker } from "@shorts-studio/usecases/ports";
import { Effect } from "effect";
import { describe, expect, it, onTestFinished } from "vitest";
import { withEnv } from "./env.ts";
import { type FakeFalOptions, startFakeFal } from "./fal.fake.ts";
import { falLayer } from "./fal.ts";
import { providerContext } from "./testing.ts";

/** FAL's provider talking to a local fake of FAL's queue, with FAL_KEY set unless `secrets` says otherwise. */
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

describe("falImageMaker submit", () => {
	it("should send the prompt, seed and image size to the model's endpoint with the key", async () => {
		// GIVEN FAL and a key
		const { fake, fal } = await withFakeFal();

		// WHEN a flux-schnell image is submitted
		const request = await Effect.runPromise(fal.submit("flux-schnell", "a red door", 7));

		// THEN FAL received the prompt, seed and image size on that model's endpoint, with the key
		expect(fake.submits).toEqual([
			{
				endpoint: "fal-ai/flux/schnell",
				authorization: "Key test-key",
				prompt: "a red door",
				seed: 7,
				imageSize: IMAGE_SIZE,
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
		const error = await Effect.runPromise(Effect.flip(fal.submit("flux-schnell", "a red door", 7)));

		// THEN it says FAL_KEY isn't set
		expect(error.code).toBe("missing-key");
		expect(error.message).toContain("FAL_KEY");
		// AND nothing reached FAL
		expect(fake.submits).toHaveLength(0);
	});

	it("should refuse a model FAL doesn't offer, listing the ones it does", async () => {
		// GIVEN FAL and a key
		const { fake, fal } = await withFakeFal();

		// WHEN an unknown model is asked for
		const error = await Effect.runPromise(Effect.flip(fal.submit("nope", "a red door", 7)));

		// THEN it is a usage error naming the known models
		expect(error.code).toBe("usage");
		expect(error.fix).toContain("flux-schnell");
		expect(fake.submits).toHaveLength(0);
		// AND the provider lists the same models
		expect(fal.models).toEqual(["flux-schnell", "flux-dev"]);
	});
});

describe("falImageMaker collect", () => {
	it("should wait until the request is done and return the image's bytes", async () => {
		// GIVEN a request FAL finishes after one more check
		const image = new Uint8Array([1, 2, 3, 4]);
		const { fal } = await withFakeFal({ pollsBeforeDone: 1, image: () => image });
		const request = await Effect.runPromise(fal.submit("flux-schnell", "a red door", 7));

		// WHEN its image is collected
		const bytes = await Effect.runPromise(fal.collect(request));

		// THEN the image's bytes come back
		expect(bytes).toEqual(image);
	});

	it("should end the request with reason RequestEnded when FAL reports it failed", async () => {
		// GIVEN a request FAL marks as failed
		const { fal } = await withFakeFal({ finalStatus: "FAILED" });
		const request = await Effect.runPromise(fal.submit("flux-schnell", "a red door", 7));

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
