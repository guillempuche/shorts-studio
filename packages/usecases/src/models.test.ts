import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { Config } from "./context.ts";
import { chooseModel, modelsFor } from "./models.ts";
import { testContext } from "./test/context.ts";
import { fakeImageMaker } from "./test/fakes.ts";

const added = {
	job: "image",
	endpoint: "fake/pro",
	billedBy: "image",
	usdPerUnit: 0.04,
	priceChecked: "2026-11-07",
} as const;

const withConfig = (config: Config) => testContext({ config });

describe("modelsFor", () => {
	it("should offer the provider's own models with config.json's changes and additions", async () => {
		// GIVEN config.json changing fake-fast's price and adding fake-pro to the same provider
		const ctx = withConfig({
			models: {
				"fake-fast": { usdPerUnit: 0.02, priceChecked: "2026-11-07" },
				"fake-pro": { provider: "fake-images", ...added },
			},
		});

		// WHEN the image models of the fake provider are listed
		const models = await Effect.runPromise(modelsFor(ctx, fakeImageMaker(), "image"));

		// THEN it has its own two and the added one
		expect(Object.keys(models).sort()).toEqual(["fake-fast", "fake-fine", "fake-pro"]);
		// AND fake-fast has the new price, and keeps the rest of its fields
		expect(models["fake-fast"]).toMatchObject({ usdPerUnit: 0.02, endpoint: "fake/fast" });
	});

	it("should leave out models of another provider or another job", async () => {
		// GIVEN config.json adding an image model to another provider, and a transcription model
		// to this one
		const ctx = withConfig({
			models: {
				"other-pro": { provider: "other", ...added },
				"fake-ears": {
					provider: "fake-images",
					job: "transcribe",
					endpoint: "fake/ears",
					billedBy: "minute",
					usdPerUnit: 0.01,
					priceChecked: "2026-11-07",
				},
			},
		});

		// WHEN the image models of the fake provider are listed
		const models = await Effect.runPromise(modelsFor(ctx, fakeImageMaker(), "image"));

		// THEN neither is among them
		expect(Object.keys(models).sort()).toEqual(["fake-fast", "fake-fine"]);
	});
});

describe("chooseModel", () => {
	const choose = (config: Config, wanted?: string) =>
		Effect.runPromise(chooseModel(withConfig(config), fakeImageMaker(), "image", wanted));

	it("should take the model asked for, then config.json's, then the provider's default", async () => {
		// GIVEN config.json choosing fake-fine for images
		const config: Config = { image: { model: "fake-fine" } };

		// WHEN a model is chosen with and without one asked for, and with no choice anywhere
		const asked = await choose(config, "fake-fast");
		const configured = await choose(config);
		const fallback = await choose({});

		// THEN each comes from the first place that names one, under its name
		expect(asked.name).toBe("fake-fast");
		expect(configured.name).toBe("fake-fine");
		expect(configured.endpoint).toBe("fake/fine");
		expect(fallback.name).toBe("fake-fast");
	});

	it("should refuse a name the provider doesn't have, listing its models", async () => {
		// GIVEN no model called "nope"
		// WHEN it is asked for
		const error = await Effect.runPromise(
			Effect.flip(chooseModel(withConfig({}), fakeImageMaker(), "image", "nope")),
		);

		// THEN it is a usage error listing the provider's models and how to add one
		expect(error.code).toBe("usage");
		expect(error.message).toContain('no model "nope"');
		expect(error.fix).toBe(
			"Use one of: fake-fast, fake-fine. Or add it under models in config.json.",
		);
	});
});
