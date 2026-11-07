/**
 * What every image provider must do, as a test suite. A provider's test file runs it with a
 * harness that builds the provider in each state; the in-memory fake runs it too, so the fake
 * the use-case tests rely on can't drift from the real providers. Only tests import this file.
 */

import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { ImageMaker } from "../ports.ts";

export interface ImageMakerHarness {
	/**
	 * The provider, with its service answering every request with an image or by giving up on
	 * it, and with or without its API key set.
	 */
	readonly make: (setup: {
		readonly answer: "image" | "ended";
		readonly withKey: boolean;
	}) => Promise<ImageMaker["Service"]>;
}

export const imageMakerContract = (name: string, harness: ImageMakerHarness): void => {
	describe(`${name}, as an image provider`, () => {
		it("should offer its default model, at a price above zero", async () => {
			// GIVEN the provider
			const maker = await harness.make({ answer: "image", withKey: true });

			// THEN its default model is one it offers, and estimating it gives a real price
			expect(maker.models).toContain(maker.defaultModel);
			expect(maker.estimateUsd(maker.defaultModel)).toBeGreaterThan(0);
		});

		it("should return the image for a request it accepted", async () => {
			// GIVEN a provider whose service makes the image
			const maker = await harness.make({ answer: "image", withKey: true });

			// WHEN an image is submitted, then collected
			const bytes = await Effect.runPromise(
				maker
					.submit(maker.defaultModel, "a red door", 7)
					.pipe(Effect.flatMap((request) => maker.collect(request))),
			);

			// THEN it comes back as bytes
			expect(bytes.length).toBeGreaterThan(0);
		});

		it("should end a request the service gave up on, so it isn't waited on again", async () => {
			// GIVEN a provider whose service gives up on every request
			const maker = await harness.make({ answer: "ended", withKey: true });

			// WHEN an image is submitted, then collected
			const error = await Effect.runPromise(
				Effect.flip(
					maker
						.submit(maker.defaultModel, "a red door", 7)
						.pipe(Effect.flatMap((request) => maker.collect(request))),
				),
			);

			// THEN it fails with reason RequestEnded, a provider failure
			expect(error.reason._tag).toBe("RequestEnded");
			expect(error.code).toBe("provider");
		});

		it("should refuse a model it doesn't offer, as a usage error", async () => {
			// GIVEN the provider
			const maker = await harness.make({ answer: "image", withKey: true });

			// WHEN an image is submitted with a model it doesn't have
			const error = await Effect.runPromise(
				Effect.flip(maker.submit("no-such-model", "a red door", 7)),
			);

			// THEN it is a usage error, before anything is paid for
			expect(error.code).toBe("usage");
		});

		it("should say which key to set when its key is missing", async (test) => {
			// GIVEN the provider without its key
			const maker = await harness.make({ answer: "image", withKey: false });
			if (maker.keys.length === 0) test.skip();

			// WHEN an image is submitted
			const error = await Effect.runPromise(
				Effect.flip(maker.submit(maker.defaultModel, "a red door", 7)),
			);

			// THEN it fails with missing-key, naming the key
			expect(error.code).toBe("missing-key");
			expect(error.message).toContain(maker.keys[0]?.env);
		});
	});
};
