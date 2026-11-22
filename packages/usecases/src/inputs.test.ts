import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { beatsOfPost, inputFile, parseBeatList } from "./inputs.ts";
import { tempDir } from "./test/context.ts";

const failureOf = <A>(effect: Effect.Effect<A, { code: string; message: string }>) =>
	Effect.runPromise(Effect.flip(effect));

describe("parseBeatList", () => {
	it("should read whole numbers separated by commas, with spaces around them", async () => {
		// GIVEN a list written with a space after a comma
		// WHEN it is read
		const list = await Effect.runPromise(parseBeatList("0, 3,4"));

		// THEN it is the three beats
		expect(list).toEqual([0, 3, 4]);
	});

	it.each(["0x", "1.5", "-1", "1,,2", ""])(
		"should refuse %j, which isn't a beat list",
		async (value) => {
			// GIVEN a value that isn't only whole numbers from 0
			// WHEN it is read
			const error = await failureOf(parseBeatList(value));

			// THEN it is a usage error
			expect(error.code).toBe("usage");
		},
	);
});

describe("beatsOfPost", () => {
	it("should name each value the post doesn't have, and the beats it has", async () => {
		// GIVEN a post with beats 0 and 1
		// WHEN beats 1 and 7 are asked for
		const error = await failureOf(beatsOfPost("1,7", "2026-11-04-x", [0, 1]));

		// THEN it is a usage error naming 7 and the beats 0–1
		expect(error.code).toBe("usage");
		expect(error.message).toBe('"7" isn\'t a beat of 2026-11-04-x, which has beats 0–1.');
	});

	it("should take beats the post has", async () => {
		// GIVEN a post with beats 0 to 2
		// WHEN beats 2 and 0 are asked for
		// THEN they are the list
		expect(await Effect.runPromise(beatsOfPost("2,0", "x", [0, 1, 2]))).toEqual([2, 0]);
	});
});

describe("inputFile", () => {
	it("should give the full path of a file that's there", async () => {
		// GIVEN a file in a folder
		const dir = tempDir();
		const file = join(dir, "a.md");
		writeFileSync(file, "a");

		// WHEN it is checked
		// THEN its full path comes back
		expect(await Effect.runPromise(inputFile(file, "fix"))).toBe(file);
	});

	it("should name the full path of a relative path with nothing there", async () => {
		// GIVEN a relative path with no file
		// WHEN it is checked
		const error = await failureOf(inputFile("nothing-here.md", "Write it first."));

		// THEN it is not found, naming the full path it looked at
		expect(error.code).toBe("not-found");
		expect(error.message).toBe(`No file at ${resolve("nothing-here.md")}.`);
	});

	it("should refuse a folder, naming it", async () => {
		// GIVEN a folder
		const dir = join(tempDir(), "audio");
		mkdirSync(dir);

		// WHEN it is checked as a file
		const error = await failureOf(inputFile(dir, "Pass a file."));

		// THEN it is a usage error naming the folder
		expect(error.code).toBe("usage");
		expect(error.message).toBe(`${dir} is a folder.`);
	});
});
