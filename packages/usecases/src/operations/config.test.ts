import { describe, expect, it } from "vitest";
import { testContext } from "../test/context.ts";
import { fakeImageMaker, fakeMediaTools, fakePorts, run, runFailure } from "../test/fakes.ts";
import { configCheck, configShow } from "./config.ts";

const MODE = { dryRun: false, confirmed: true } as const;
const IMAGES_KEY = { env: "FAKE_IMAGES_KEY", keychain: "fake-images" };

/** A machine where ffmpeg is missing, and an image provider that needs a key. */
const brokenMachine = () =>
	fakePorts({
		mediaTools: fakeMediaTools({
			checks: [
				{ name: "ffmpeg", status: "fail", detail: "not found", fix: "Enter the Nix shell." },
				{ name: "yt-dlp", status: "warn", detail: "old", fix: "pip install -U yt-dlp" },
			],
		}),
		imageMaker: fakeImageMaker({ keys: [IMAGES_KEY] }),
	});

describe("config check (doctor)", () => {
	it("should fail with each blocking problem and its fix", async () => {
		// GIVEN a machine with no ffmpeg and the image provider's key not set
		const ctx = testContext();

		// WHEN the check runs
		const error = await runFailure(configCheck.run({}, ctx, MODE), brokenMachine());

		// THEN it fails as a missing tool, naming ffmpeg and the key, each with its fix
		expect(error.code).toBe("missing-tool");
		expect(error.message).toContain("2 blocking problems");
		expect(error.message).toMatch(/✗ ffmpeg +not found\n +→ Enter the Nix shell\./);
		expect(error.message).toMatch(
			/✗ FAKE_IMAGES_KEY +missing \(fake-images needs it\)\n +→ export/,
		);
		// AND a warning alone doesn't block
		expect(error.message).not.toContain("yt-dlp");
	});

	it("should report a settings file that couldn't be read", async () => {
		// GIVEN a config.json that wasn't valid, so the defaults apply
		const ctx = testContext({
			settingsIssues: ['/data/config.json: Expected number, got "lots"'],
		});

		// WHEN the check runs
		const error = await runFailure(configCheck.run({}, ctx, MODE));

		// THEN it names the file and says how to fix it
		expect(error.code).toBe("missing-tool");
		expect(error.message).toContain("/data/config.json");
		expect(error.message).toContain("Fix that setting, or remove it to use the default.");
	});

	it("should warn about a setting that fell back to its default, without failing", async () => {
		// GIVEN a TZ that names no zone, so days follow UTC
		const ctx = testContext({
			settingsWarnings: ['TZ is "Mars/Base", which isn\'t a time zone name'],
		});

		// WHEN the check runs
		const result = await run(configCheck.run({}, ctx, MODE));

		// THEN it passes, with a warning that names TZ and says how to fix it
		expect(result.checks).toContainEqual(
			expect.objectContaining({
				name: "settings",
				status: "warn",
				detail: expect.stringContaining("TZ"),
			}),
		);
	});

	it("should pass when every tool works and every key is set", async () => {
		// GIVEN a working machine with the image provider's key set
		const ctx = testContext({ secrets: { FAKE_IMAGES_KEY: "k" } });
		const ports = fakePorts({ imageMaker: fakeImageMaker({ keys: [IMAGES_KEY] }) });

		// WHEN the check runs
		const result = await run(configCheck.run({}, ctx, MODE), ports);

		// THEN the key shows as set, never its value
		expect(result.checks).toEqual([
			{ name: "FAKE_IMAGES_KEY", status: "ok", detail: "set (fake-images needs it)" },
		]);
	});
});

describe("config check (doctor), about models", () => {
	/** config.json changing only the day fake-fast's price was checked. */
	const checkedOn = (day: string) =>
		testContext({ config: { models: { "fake-fast": { priceChecked: day } } } });

	it("should warn, and still pass, when the price in use was checked more than 90 days ago", async () => {
		// GIVEN the image model in use, priced 120 days before today (2026-11-04)
		const ctx = checkedOn("2026-07-07");

		// WHEN the check runs
		const result = await run(configCheck.run({}, ctx, MODE));

		// THEN it warns, saying where to update the price
		const row = result.checks.find((c) => c.name === "image model");
		expect(row).toMatchObject({ status: "warn" });
		expect(row?.detail).toContain("checked 120 days ago");
		expect(row?.fix).toContain("models.fake-fast.usdPerUnit and priceChecked");
		// AND it still ends with Ready.
		expect(configCheck.render?.(result).endsWith("Ready.")).toBe(true);
	});

	it("should not warn about a price checked exactly 90 days ago", async () => {
		// GIVEN the image model in use, priced 90 days before today
		const ctx = checkedOn("2026-08-06");

		// WHEN the check runs
		const result = await run(configCheck.run({}, ctx, MODE));

		// THEN there is nothing to say about it
		expect(result.checks.find((c) => c.name === "image model")).toBeUndefined();
	});

	it("should warn about a model in config.json that no provider in use claims", async () => {
		// GIVEN config.json repricing "fake-fsat", a misspelt fake-fast
		const ctx = testContext({ config: { models: { "fake-fsat": { usdPerUnit: 0.02 } } } });

		// WHEN the check runs
		const result = await run(configCheck.run({}, ctx, MODE));

		// THEN it warns, naming the entry and how to check it
		expect(result.checks).toContainEqual(
			expect.objectContaining({
				name: "models",
				status: "warn",
				detail: expect.stringContaining("models.fake-fsat"),
			}),
		);
	});

	it("should fail when the image model config.json chooses doesn't exist", async () => {
		// GIVEN config.json choosing an image model the provider doesn't have
		const ctx = testContext({ config: { image: { model: "nope" } } });

		// WHEN the check runs
		const error = await runFailure(configCheck.run({}, ctx, MODE));

		// THEN it fails, since every image would fail, naming the model and the ones to use
		expect(error.message).toContain('no model "nope"');
		expect(error.message).toContain("fake-fast, fake-fine");
	});
});

describe("config show", () => {
	it("should show the folders, the caps and the providers in use", async () => {
		// GIVEN a $3 daily cap, and the default monthly and per-post caps
		const ctx = testContext({ config: { caps: { dailyUsd: 3 } } });

		// WHEN the settings are shown
		const result = await run(configShow.run({}, ctx, MODE));

		// THEN they show where things live, the caps and each provider with its model
		expect(result.paths).toEqual(ctx.paths);
		expect(result.caps).toEqual({ dailyUsd: 3, monthlyUsd: 100, postUsd: 2 });
		// AND the time zone the caps' days and months follow
		expect(result.timeZone).toBe("UTC");
		expect(result.transcriber).toBe("fake-transcriber fake-whisper");
		expect(result.imageProvider).toBe("fake-images");
		// AND the image model stays where scripts already read it
		expect(result.imageModel).toBe("fake-fast");
	});
});
