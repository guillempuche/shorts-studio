import { describe, expect, it } from "vitest";
import { closest } from "./closest.ts";

const CAPS = ["dailyUsd", "monthlyUsd", "postUsd"];

describe("closest", () => {
	it("should name the candidate the name is the start of", () => {
		// GIVEN a cap written without its unit
		// WHEN the closest cap is looked for
		const meant = closest("daily", CAPS);

		// THEN it is the cap that name starts
		expect(meant).toBe("dailyUsd");
	});

	it("should name the shortest when the name starts several", () => {
		// GIVEN a name that starts both caps and captions
		// WHEN the closest group is looked for
		const meant = closest("cap", ["captions", "caps"]);

		// THEN it is the shorter one
		expect(meant).toBe("caps");
	});

	it("should name the nearest by edit distance, within a third of the name's length", () => {
		// GIVEN a cap with two letters swapped, two edits away in eight letters
		// WHEN the closest cap is looked for
		const meant = closest("dialyUsd", CAPS);

		// THEN it is the cap that was meant
		expect(meant).toBe("dailyUsd");
	});

	it("should ignore case", () => {
		// GIVEN a variable written in lower case
		// WHEN the closest variable is looked for
		const meant = closest("shorts_caps_daily", ["SHORTS_CAPS_DAILY_USD", "SHORTS_CAPS_POST_USD"]);

		// THEN it is the variable as it's written
		expect(meant).toBe("SHORTS_CAPS_DAILY_USD");
	});

	it.each([
		["a word near none of them", "limits"],
		["nothing", ""],
	])("should name none for %s", (_, name) => {
		// GIVEN a name further than a third of its length from every candidate
		// WHEN the closest is looked for
		const meant = closest(name, CAPS);

		// THEN none is named, rather than a guess
		expect(meant).toBeUndefined();
	});
});
