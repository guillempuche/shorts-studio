import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "@shorts-studio/usecases/test/context";
import { DateTime, Redacted } from "effect";
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

	it("should refuse a negative cap, naming it, and keep the default", () => {
		// GIVEN a config.json with a daily cap of −1
		const data = join(tempDir(), "data");
		mkdirSync(data, { recursive: true });
		writeFileSync(join(data, "config.json"), '{ "caps": { "dailyUsd": -1 } }');

		// WHEN the settings are loaded
		const ctx = makeContext({ SHORTS_DATA_DIR: data });

		// THEN the defaults apply, and the problem names the cap
		expect(ctx.config).toEqual({});
		expect(ctx.settingsIssues[0]).toContain("dailyUsd");
	});

	it("should follow the time zone TZ names", () => {
		// GIVEN TZ set to Tokyo
		// WHEN the context is made
		const ctx = makeContext({ SHORTS_DATA_DIR: "/d", TZ: "Asia/Tokyo" });

		// THEN days and months follow Tokyo, with nothing to report
		expect(DateTime.zoneToString(ctx.timeZone)).toBe("Asia/Tokyo");
		expect(ctx.settingsIssues).toEqual([]);
	});

	it.each([
		["a leading colon", ":Asia/Tokyo"],
		["a path under zoneinfo", ":/usr/share/zoneinfo/Asia/Tokyo"],
	])("should read a TZ written with %s as the zone it names", (_, tz) => {
		// GIVEN TZ in one of its POSIX forms
		// WHEN the context is made
		const ctx = makeContext({ SHORTS_DATA_DIR: "/d", TZ: tz });

		// THEN days and months follow Tokyo, with nothing to warn about
		expect(DateTime.zoneToString(ctx.timeZone)).toBe("Asia/Tokyo");
		expect(ctx.settingsWarnings).toEqual([]);
	});

	it("should read TZ=:/etc/localtime as the machine's own zone", () => {
		// GIVEN TZ pointing at the machine's zone file, as Linux containers often set it
		// WHEN the context is made
		const ctx = makeContext({ SHORTS_DATA_DIR: "/d", TZ: ":/etc/localtime" });

		// THEN days and months follow the machine's zone, with nothing to warn about
		expect(DateTime.zoneToString(ctx.timeZone)).toBe(
			DateTime.zoneToString(DateTime.zoneMakeLocal()),
		);
		expect(ctx.settingsWarnings).toEqual([]);
	});

	it.each([
		["a typo", "Mars/Base"],
		["a POSIX rule", "UTC+3"],
		["nothing", ""],
	])("should fall back to UTC, and warn, when TZ names %s", (_, tz) => {
		// GIVEN TZ set to something that isn't a time zone name
		// WHEN the context is made
		const ctx = makeContext({ SHORTS_DATA_DIR: "/d", TZ: tz });

		// THEN days and months follow UTC
		expect(DateTime.zoneToString(ctx.timeZone)).toBe("UTC");
		// AND doctor will warn, naming TZ and what it was set to, without a blocking problem
		expect(ctx.settingsWarnings).toHaveLength(1);
		expect(ctx.settingsWarnings[0]).toContain(`TZ is "${tz}"`);
		expect(ctx.settingsIssues).toEqual([]);
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

	it("should report a SHORTS_* variable that isn't valid, and still use the file and the other variables", () => {
		// GIVEN a config.json with a lowered cap
		const data = join(tempDir(), "data");
		mkdirSync(data, { recursive: true });
		writeFileSync(join(data, "config.json"), '{ "caps": { "dailyUsd": 1 } }');

		// WHEN the per-post cap is set to a word in the environment, and the caption size properly
		const ctx = makeContext({
			SHORTS_DATA_DIR: data,
			SHORTS_CAPS_POST_USD: "lots",
			SHORTS_CAPTIONS_FONT_SIZE: "64",
		});

		// THEN the file's cap and the valid variable apply, and only the bad variable is dropped
		expect(ctx.config).toEqual({ caps: { dailyUsd: 1 }, captions: { fontSize: 64 } });
		// AND the problem names that variable, for doctor to report
		expect(ctx.settingsIssues).toHaveLength(1);
		expect(ctx.settingsIssues[0]).toContain("SHORTS_CAPS_POST_USD");
	});

	it.each([
		["a list instead of an object", '[{ "caps": { "dailyUsd": 1 } }]', {}],
		[
			"a word where a group of settings goes",
			'{ "captions": "big" }',
			{ SHORTS_CAPTIONS_FONT_SIZE: "64" },
		],
	])("should report a config.json with %s, even when variables are set", (_, file, vars) => {
		// GIVEN a config.json whose shape is wrong
		const data = join(tempDir(), "data");
		mkdirSync(data, { recursive: true });
		writeFileSync(join(data, "config.json"), file);

		// WHEN the settings are loaded
		const ctx = makeContext({ SHORTS_DATA_DIR: data, ...vars });

		// THEN the file is reported rather than passed over, and only the variables apply
		expect(ctx.config).toEqual(
			Object.keys(vars).length === 0 ? {} : { captions: { fontSize: 64 } },
		);
		expect(ctx.settingsIssues).toHaveLength(1);
		expect(ctx.settingsIssues[0]).toContain(join(data, "config.json"));
	});

	it("should read a number or yes/no written as text in config.json, as earlier versions did", () => {
		// GIVEN a config.json with a cap and the word highlight written as strings
		const data = join(tempDir(), "data");
		mkdirSync(data, { recursive: true });
		writeFileSync(
			join(data, "config.json"),
			'{ "caps": { "dailyUsd": "1" }, "captions": { "highlight": "true", "font": "Inter" } }',
		);

		// WHEN the settings are loaded
		const ctx = makeContext({ SHORTS_DATA_DIR: data });

		// THEN they're read as the values they name, so the lowered cap holds
		expect(ctx.config).toEqual({
			caps: { dailyUsd: 1 },
			captions: { highlight: true, font: "Inter" },
		});
		expect(ctx.settingsIssues).toEqual([]);
	});

	it("should still apply valid SHORTS_* variables when config.json isn't valid", () => {
		// GIVEN a config.json that isn't JSON
		const data = join(tempDir(), "data");
		mkdirSync(data, { recursive: true });
		writeFileSync(join(data, "config.json"), "{ caps: ");

		// WHEN the per-post cap is set in the environment
		const ctx = makeContext({ SHORTS_DATA_DIR: data, SHORTS_CAPS_POST_USD: "0.5" });

		// THEN the cap from the environment holds, and the file is reported
		expect(ctx.config).toEqual({ caps: { postUsd: 0.5 } });
		expect(ctx.settingsIssues).toHaveLength(1);
		expect(ctx.settingsIssues[0]).toContain(join(data, "config.json"));
	});

	it("should keep the rest of config.json when a variable sets a setting whose name starts like another's", () => {
		// GIVEN a config.json with a lowered cap and a caption font
		const data = join(tempDir(), "data");
		mkdirSync(data, { recursive: true });
		writeFileSync(
			join(data, "config.json"),
			'{ "caps": { "dailyUsd": 1 }, "captions": { "font": "Inter" } }',
		);

		// WHEN the caption size is set in the environment (FONT_SIZE begins with FONT)
		const ctx = makeContext({ SHORTS_DATA_DIR: data, SHORTS_CAPTIONS_FONT_SIZE: "64" });

		// THEN the size comes from the environment and everything else from the file
		expect(ctx.config).toEqual({
			caps: { dailyUsd: 1 },
			captions: { font: "Inter", fontSize: 64 },
		});
		expect(ctx.settingsIssues).toEqual([]);
	});

	it("should set a caption size from the environment when no font is set anywhere", () => {
		// GIVEN no settings file
		// WHEN only the caption size is set in the environment
		const ctx = makeContext({
			SHORTS_DATA_DIR: join(tempDir(), "data"),
			SHORTS_CAPTIONS_FONT_SIZE: "64",
		});

		// THEN that one setting is used, with nothing to report
		expect(ctx.config).toEqual({ captions: { fontSize: 64 } });
		expect(ctx.settingsIssues).toEqual([]);
	});

	it("should take models from config.json only, exactly as written", () => {
		// GIVEN a config.json with a price override whose option is a string of digits
		const data = join(tempDir(), "data");
		mkdirSync(data, { recursive: true });
		writeFileSync(
			join(data, "config.json"),
			'{ "models": { "flux-dev": { "usdPerUnit": 0.03, "options": { "steps": "28" } } } }',
		);

		// WHEN a variable that looks like a model setting is also set
		const ctx = makeContext({ SHORTS_DATA_DIR: data, SHORTS_MODELS_MINE_PROVIDER: "fal" });

		// THEN the file's model is kept as written, and the variable doesn't add one
		expect(ctx.config.models).toEqual({
			"flux-dev": { usdPerUnit: 0.03, options: { steps: "28" } },
		});
		expect(ctx.settingsIssues).toEqual([]);
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

	it("should name the marker of the agent whose shell it runs in", () => {
		// GIVEN an agent's marker in the environment, and another environment without it
		// WHEN a context is made from each
		const inAgent = makeContext({ SHORTS_DATA_DIR: "/d", CLAUDECODE: "1" });
		const plain = makeContext({ SHORTS_DATA_DIR: "/d", CLAUDECODE: "" });

		// THEN only the first names a marker
		expect(inAgent.agentShell).toBe("CLAUDECODE");
		expect(plain.agentShell).toBeUndefined();
	});
});
