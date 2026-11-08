import { describe, expect, it } from "vitest";
import { testContext } from "../test/context.ts";
import { run } from "../test/fakes.ts";
import { modelsList } from "./models.ts";

const MODE = { dryRun: false, confirmed: true } as const;

describe("models list", () => {
	it("should list each job's models with its price, when it was checked and the one in use", async () => {
		// GIVEN the fake providers' own models, priced on 2026-11-01, and today 2026-11-04
		const ctx = testContext();

		// WHEN the models are listed
		const result = await run(modelsList.run({}, ctx, MODE));

		// THEN each job's models come with their price and age, and the defaults are in use
		expect(
			result.models.map((m) => [m.job, m.name, m.usdPerUnit, m.daysSinceChecked, m.inUse]),
		).toEqual([
			["image", "fake-fast", 0.01, 3, true],
			["image", "fake-fine", 0.05, 3, false],
			["transcribe", "fake-whisper", 0.006, 3, true],
		]);
		expect(result.staleAfterDays).toBe(90);
	});

	it("should show a model config.json adds, a price it changes, and the model it chooses", async () => {
		// GIVEN config.json adding fake-pro, repricing fake-fine, and choosing fake-fine for images
		const ctx = testContext({
			config: {
				image: { model: "fake-fine" },
				models: {
					"fake-fine": { usdPerUnit: 0.07, priceChecked: "2026-11-04" },
					"fake-pro": {
						provider: "fake-images",
						job: "image",
						endpoint: "fake/pro",
						billedBy: "image",
						usdPerUnit: 0.1,
						priceChecked: "2026-11-02",
					},
				},
			},
		});

		// WHEN the models are listed
		const result = await run(modelsList.run({}, ctx, MODE));

		// THEN the image models show those changes, with fake-fine in use
		const images = result.models.filter((m) => m.job === "image");
		expect(images.map((m) => [m.name, m.usdPerUnit, m.daysSinceChecked, m.inUse])).toEqual([
			["fake-fast", 0.01, 3, false],
			["fake-fine", 0.07, 0, true],
			["fake-pro", 0.1, 2, false],
		]);
	});
});
