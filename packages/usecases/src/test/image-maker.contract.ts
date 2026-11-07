/**
 * What every image provider must do, as a test suite. A provider's test file runs it with a
 * harness that builds the provider in each state; the in-memory fake runs it too, so the fake
 * the use-case tests rely on can't drift from the real providers. Only tests import this file.
 */

import { imageAmount, Model, price } from "@shorts-studio/domain/models";
import { Effect, Schema } from "effect";
import { describe, expect, it } from "vitest";
import type { ImageMaker } from "../ports.ts";
import { defaultModelOf } from "./models.ts";

export interface ImageMakerHarness {
	/**
	 * The provider, with its service answering every request with an image, by giving up on it,
	 * or by refusing it with an HTTP 4xx, and with or without its API key set.
	 */
	readonly make: (setup: {
		readonly answer: "image" | "ended" | "refused";
		readonly withKey: boolean;
	}) => Promise<ImageMaker["Service"]>;
}

export const imageMakerContract = (name: string, harness: ImageMakerHarness): void => {
	describe(`${name}, as an image provider`, () => {
		it("should offer whole image models of its own, with its default among them", async () => {
			// GIVEN the provider
			const maker = await harness.make({ answer: "image", withKey: true });

			// THEN its default model is one of its own
			expect(Object.keys(maker.models)).toContain(maker.defaultModel);
			// AND each of its models is a whole image model of this provider, with a real price
			for (const [modelName, model] of Object.entries(maker.models)) {
				expect(Schema.is(Model)(model), modelName).toBe(true);
				expect(model.provider, modelName).toBe(maker.provider);
				expect(model.job, modelName).toBe("image");
				expect(price(model, imageAmount(model)).usd, modelName).toBeGreaterThan(0);
			}
		});

		it("should return the image for a request it accepted", async () => {
			// GIVEN a provider whose service makes the image
			const maker = await harness.make({ answer: "image", withKey: true });

			// WHEN an image is submitted, then collected
			const bytes = await Effect.runPromise(
				maker
					.submit(defaultModelOf(maker), "a red door", 7)
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
						.submit(defaultModelOf(maker), "a red door", 7)
						.pipe(Effect.flatMap((request) => maker.collect(request))),
				),
			);

			// THEN it fails with reason RequestEnded, a provider failure
			expect(error.reason._tag).toBe("RequestEnded");
			expect(error.code).toBe("provider");
		});

		it("should report a request the service refuses as Refused, which billed nothing", async () => {
			// GIVEN a provider whose service refuses every request
			const maker = await harness.make({ answer: "refused", withKey: true });

			// WHEN an image is submitted
			const error = await Effect.runPromise(
				Effect.flip(maker.submit(defaultModelOf(maker), "a red door", 7)),
			);

			// THEN it fails with reason Refused, a provider failure, so its reservation is freed
			expect(error.reason._tag).toBe("Refused");
			expect(error.code).toBe("provider");
		});

		it("should say which key to set when its key is missing", async (test) => {
			// GIVEN the provider without its key
			const maker = await harness.make({ answer: "image", withKey: false });
			// A provider that needs no key can't miss one.
			if (maker.keys.length === 0) test.skip();

			// WHEN an image is submitted
			const error = await Effect.runPromise(
				Effect.flip(maker.submit(defaultModelOf(maker), "a red door", 7)),
			);

			// THEN it fails with missing-key, naming the key
			expect(error.code).toBe("missing-key");
			expect(error.message).toContain(maker.keys[0]?.env);
		});
	});
};
