import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "@shorts-studio/usecases/test/context";
import { Redacted } from "effect";
import { describe, expect, it } from "vitest";
import { makeContext } from "./node.ts";

describe("makeContext", () => {
	it("should keep the defaults when config.json is invalid, and record why", () => {
		// GIVEN a config.json with a cap that isn't a number
		const data = join(tempDir(), "data");
		mkdirSync(data, { recursive: true });
		writeFileSync(join(data, "config.json"), '{ "caps": { "dailyUsd": "lots" } }');

		// WHEN the settings are loaded
		const ctx = makeContext({ SHORTS_DATA_DIR: data });

		// THEN nothing crashed and the defaults apply
		expect(ctx.config).toEqual({});
		// AND the problem names the file, for doctor to report
		expect(ctx.settingsIssues).toHaveLength(1);
		expect(ctx.settingsIssues[0]).toContain(join(data, "config.json"));
	});

	it("should read valid settings files", () => {
		// GIVEN a config.json and a brand.json
		const data = join(tempDir(), "data");
		mkdirSync(data, { recursive: true });
		writeFileSync(join(data, "config.json"), '{ "caps": { "dailyUsd": 3 } }');
		writeFileSync(join(data, "brand.json"), '{ "imagePrompt": { "suffix": "film grain" } }');

		// WHEN the settings are loaded
		const ctx = makeContext({ SHORTS_DATA_DIR: data });

		// THEN both are used, with no problem recorded
		expect(ctx.config).toEqual({ caps: { dailyUsd: 3 } });
		expect(ctx.brand).toEqual({ imagePrompt: { suffix: "film grain" } });
		expect(ctx.settingsIssues).toEqual([]);
	});

	it("should let a SHORTS_* variable replace one setting and keep the rest of the file", () => {
		// GIVEN a config.json with a model and both caps
		const data = join(tempDir(), "data");
		mkdirSync(data, { recursive: true });
		writeFileSync(
			join(data, "config.json"),
			'{ "image": { "model": "flux-dev" }, "caps": { "dailyUsd": 3, "postUsd": 1 } }',
		);

		// WHEN the settings are loaded with the model and the daily cap set in the environment
		const ctx = makeContext({
			SHORTS_DATA_DIR: data,
			SHORTS_IMAGE_MODEL: "flux-schnell",
			SHORTS_CAPS_DAILY_USD: "7",
		});

		// THEN those two come from the environment and the per-post cap from the file
		expect(ctx.config).toEqual({
			image: { model: "flux-schnell" },
			caps: { dailyUsd: 7, postUsd: 1 },
		});
		expect(ctx.settingsIssues).toEqual([]);
	});

	it("should report a SHORTS_* variable that isn't valid, naming the setting", () => {
		// GIVEN no settings file
		// WHEN the daily cap is set to a word in the environment
		const ctx = makeContext({
			SHORTS_DATA_DIR: join(tempDir(), "data"),
			SHORTS_CAPS_DAILY_USD: "lots",
		});

		// THEN the defaults apply and the problem names the setting
		expect(ctx.config).toEqual({});
		expect(ctx.settingsIssues[0]).toContain('["caps"]["dailyUsd"]');
	});

	it("should read brand overrides from SHORTS_BRAND_* variables", () => {
		// GIVEN no brand.json
		// WHEN the image style is set in the environment
		const ctx = makeContext({
			SHORTS_DATA_DIR: join(tempDir(), "data"),
			SHORTS_BRAND_IMAGE_PROMPT_SUFFIX: "film grain",
		});

		// THEN the brand uses it
		expect(ctx.brand).toEqual({ imagePrompt: { suffix: "film grain" } });
	});

	it("should take the folders from the environment, with posts inside the data folder by default", () => {
		// GIVEN a data folder set in the environment, and then a posts folder too
		// WHEN the context is made
		const dataOnly = makeContext({ SHORTS_DATA_DIR: "/d" });
		const both = makeContext({ SHORTS_DATA_DIR: "/d", SHORTS_POSTS_DIR: "/p" });

		// THEN posts live in the data folder unless their own folder is set
		expect(dataOnly.paths).toEqual({ data: "/d", posts: join("/d", "posts") });
		expect(both.paths).toEqual({ data: "/d", posts: "/p" });
	});

	it("should point a provider at the base URL its SHORTS_<NAME>_URL gives", () => {
		// GIVEN a fake FAL's address in the environment
		// WHEN the context is made
		const ctx = makeContext({ SHORTS_DATA_DIR: "/d", SHORTS_FAL_URL: "http://127.0.0.1:9" });

		// THEN FAL's requests go there
		expect(ctx.endpoints).toEqual({ fal: "http://127.0.0.1:9" });
	});

	it("should map a provider name with several words to its kebab-case name", () => {
		// GIVEN a fake for a provider whose name has two words
		// WHEN the context is made
		const ctx = makeContext({ SHORTS_DATA_DIR: "/d", SHORTS_FISH_AUDIO_URL: "http://127.0.0.1:9" });

		// THEN the address is found under the provider's name
		expect(ctx.endpoints).toEqual({ "fish-audio": "http://127.0.0.1:9" });
	});

	it("should read an API key from the environment, hidden when printed", async () => {
		// GIVEN FAL_KEY in the environment
		const ctx = makeContext({ SHORTS_DATA_DIR: "/d", FAL_KEY: "from-env" });

		// WHEN the key is asked for
		const key = await ctx.secret({ env: "FAL_KEY", keychain: "fal-key" });

		// THEN the environment's value is used
		expect(key && Redacted.value(key)).toBe("from-env");
		// AND printing it, as a log line or an error would, doesn't show it
		expect(String(key)).not.toContain("from-env");
		expect(JSON.stringify({ key })).not.toContain("from-env");
	});
});
