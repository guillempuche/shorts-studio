import { describe, expect, it } from "vitest";
import { roundUsd, usd, usdOf } from "./money.ts";

describe("usd", () => {
	it.each([
		[0, "$0.00"],
		[0.0003, "$0.0003"],
		[0.012, "$0.012"],
		[0.07215, "$0.072"],
		[0.5, "$0.50"],
		[2, "$2.00"],
	])("should show %d as %s", (amount, shown) => {
		// GIVEN an amount
		// WHEN it is shown
		// THEN it has two decimals, or more until two significant digits show
		expect(usd(amount)).toBe(shown);
	});

	it("should never show an amount above $0 as $0.00", () => {
		// GIVEN an amount below a millionth of a dollar
		// WHEN it is shown
		// THEN it reads as less than a millionth, not as nothing
		expect(usd(0.0000001)).toBe("<$0.000001");
	});
});

describe("usdOf", () => {
	it.each([
		[0.003, 0.004],
		[0.005, 0.01],
		[1.996, 2],
		[0.0003, 2],
	])("should show $%d and a cap of $%d as different amounts", (amount, cap) => {
		// GIVEN an amount below the cap it's compared with
		// WHEN both are shown
		const [shownAmount, shownCap] = usdOf(amount, cap);

		// THEN they read differently, and the amount isn't $0.00
		expect(shownAmount).not.toBe(shownCap);
		expect(shownAmount).not.toBe("$0.00");
	});

	it("should show both with the fewest decimals at which they differ", () => {
		// GIVEN amounts that differ at the third decimal, and ones that differ at the second
		// WHEN each pair is shown
		// THEN each pair has as many decimals as it takes, and no more
		expect(usdOf(0.003, 0.004)).toEqual(["$0.003", "$0.004"]);
		expect(usdOf(0.005, 0.01)).toEqual(["$0.005", "$0.010"]);
		expect(usdOf(0.4, 2)).toEqual(["$0.40", "$2.00"]);
	});

	it("should show equal amounts as usd does", () => {
		// GIVEN an amount equal to its cap
		// WHEN both are shown
		// THEN both read the same, with two decimals
		expect(usdOf(2, 2)).toEqual(["$2.00", "$2.00"]);
	});
});

describe("roundUsd", () => {
	it("should round a float sum to millionths of a dollar", () => {
		// GIVEN three reservations of $0.02405, summed as floats
		const sum = 0.02405 + 0.02405 + 0.02405;

		// WHEN it is rounded
		// THEN it is the exact total
		expect(roundUsd(sum)).toBe(0.07215);
	});
});
