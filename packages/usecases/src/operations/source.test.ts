import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Context } from "../context.ts";
import { postDir } from "../post-store.ts";
import { testContext } from "../test/context.ts";
import { fakeMediaTools, fakePorts, run, runFailure } from "../test/fakes.ts";
import { seedPost } from "../test/posts.ts";
import { sourceImport } from "./source.ts";

const SLUG = "2026-11-04-source";
const MODE = { dryRun: false, confirmed: true } as const;

/** A file of the user's, outside the posts folder. */
const userFile = (ctx: Context, name: string): string => {
	mkdirSync(ctx.paths.data, { recursive: true });
	writeFileSync(join(ctx.paths.data, name), "sound");
	return join(ctx.paths.data, name);
};

const manifestOf = (ctx: Context) => readFileSync(join(postDir(ctx, SLUG), "post.json"), "utf8");

const importFile = (ctx: Context, file: string) =>
	sourceImport.run({ post: SLUG, file, origin: "mine", kind: "speech" }, ctx, MODE);

describe("source import", () => {
	it("should import audio it can hear", async () => {
		// GIVEN a post and a recording
		const ctx = testContext();
		await seedPost(ctx, SLUG);

		// WHEN it is imported
		const result = await run(importFile(ctx, userFile(ctx, "voice.m4a")));

		// THEN the post's audio is saved
		expect(result.file).toBe(join(postDir(ctx, SLUG), "audio", "audio.m4a"));
	});

	it.each([
		[
			"a file ffmpeg can't read",
			{ audioStreams: { "notes.txt": undefined } },
			"notes.txt",
			"isn't audio or video",
		],
		[
			"a video with no sound",
			{ audioStreams: { "silent-film.mp4": 0 } },
			"silent-film.mp4",
			"has no audio track",
		],
		["silence from start to end", { peakDb: { "room.wav": -91 } }, "room.wav", "is silent"],
	] as const)("should refuse %s, naming it and changing nothing", async (_, media, name, says) => {
		// GIVEN a post and that file
		const ctx = testContext();
		await seedPost(ctx, SLUG);
		const file = userFile(ctx, name);
		const before = manifestOf(ctx);

		// WHEN it is imported
		const error = await runFailure(
			importFile(ctx, file),
			fakePorts({ mediaTools: fakeMediaTools(media) }),
		);

		// THEN it is a usage error naming the file given, never the temporary one
		expect(error.code).toBe("usage");
		expect(error.message).toContain(file);
		expect(error.message).toContain(says);
		expect(error.message).not.toContain("audio.tmp.m4a");
		// AND post.json is as it was, with no file left behind
		expect(manifestOf(ctx)).toBe(before);
		expect(existsSync(join(postDir(ctx, SLUG), "audio", "audio.tmp.m4a"))).toBe(false);
	});

	it("should refuse a folder, naming it", async () => {
		// GIVEN a post and a folder
		const ctx = testContext();
		await seedPost(ctx, SLUG);
		const folder = join(ctx.paths.data, "exports");
		mkdirSync(folder, { recursive: true });

		// WHEN the folder is imported
		const error = await runFailure(importFile(ctx, folder));

		// THEN it is a usage error naming the folder
		expect(error.code).toBe("usage");
		expect(error.message).toContain(folder);
	});
});
