import { Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { imageAmount, Model, ModelSettings, price } from "./models.ts";

const flux: Model = {
	provider: "fal",
	job: "image",
	endpoint: "fal-ai/flux/schnell",
	billedBy: "megapixel",
	usdPerUnit: 0.003,
	roundUp: true,
	priceChecked: "2026-11-07",
};

const decode = (input: unknown) => Schema.decodeUnknownResult(Model)(input);

describe("price", () => {
	it("should bill a 1344×2400 image as 4 megapixels when the model rounds up", () => {
		// GIVEN a model at $0.003 per megapixel, rounded up
		// WHEN one image at the frame size is priced
		const cost = price(flux, imageAmount(flux));

		// THEN it is 4 megapixels, $0.012
		expect(cost.units).toBe(4);
		expect(cost.usd).toBeCloseTo(0.012);
	});

	it("should bill the exact amount when the model doesn't round", () => {
		// GIVEN a model at $0.0015 a minute, not rounded
		const whisper: Model = {
			provider: "together",
			job: "transcribe",
			endpoint: "openai/whisper-large-v3",
			billedBy: "minute",
			usdPerUnit: 0.0015,
			priceChecked: "2026-11-07",
		};

		// WHEN 1.5 minutes (90 seconds) are priced
		const cost = price(whisper, 1.5);

		// THEN it is 1.5 minutes
		expect(cost.units).toBe(1.5);
		expect(cost.usd).toBeCloseTo(0.00225);
	});

	it("should count one unit per image when a model is billed by the image", () => {
		// GIVEN a model billed by the image
		const perImage: Model = { ...flux, billedBy: "image", usdPerUnit: 0.04 };

		// WHEN one image is priced
		const cost = price(perImage, imageAmount(perImage));

		// THEN it is one image
		expect(cost).toEqual({ units: 1, usd: 0.04 });
	});
});

describe("Model", () => {
	it("should refuse a unit its job can't be billed by", () => {
		// GIVEN an image model billed by the minute
		// WHEN it is read
		const result = decode({ ...flux, billedBy: "minute" });

		// THEN it is refused, saying what an image model is billed by
		expect(Result.isFailure(result)).toBe(true);
		if (Result.isFailure(result)) {
			expect(result.failure.message).toContain("megapixel or image");
		}
	});

	it("should refuse a negative price and a date that isn't YYYY-MM-DD", () => {
		// GIVEN a model with a negative price, and one checked on "last week"
		// WHEN each is read
		// THEN both are refused
		expect(Result.isFailure(decode({ ...flux, usdPerUnit: -1 }))).toBe(true);
		expect(Result.isFailure(decode({ ...flux, priceChecked: "last week" }))).toBe(true);
	});
});

describe("ModelSettings", () => {
	it("should accept a price on its own, to reprice a built-in model", () => {
		// GIVEN a settings entry with only a price and the day it was checked
		// WHEN it is read
		const result = Schema.decodeUnknownResult(ModelSettings)({
			usdPerUnit: 0.03,
			priceChecked: "2026-12-01",
		});

		// THEN it is accepted as it is
		expect(Result.getOrUndefined(result)).toEqual({ usdPerUnit: 0.03, priceChecked: "2026-12-01" });
	});
});
