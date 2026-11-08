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
