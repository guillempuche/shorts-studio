import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Beat, Post } from "@shorts-studio/domain/post";
import { describe, expect, it } from "vitest";
import type { Context } from "./context.ts";
import { hashOf } from "./files.ts";
import {
	draftInputHash,
	freshnessOf,
	imageInputHash,
	planInputHash,
	recutInputHash,
	seedOf,
	UP_TO_DATE,
} from "./freshness.ts";
import { postDir } from "./post-store.ts";
import { testContext } from "./test/context.ts";
import { fakeMediaTools, run } from "./test/fakes.ts";
import { seedUpToDate, withDraft } from "./test/posts.ts";

const SLUG = "2026-11-04-fresh";
const RENDERER = fakeMediaTools().rendererVersion;

const audio = (hash = "a1", kind: "speech" | "music" = "speech") => ({
	file: "audio/audio.m4a",
	hash,
	origin: "mine" as const,
	kind,
	durationSec: 4,
	source: "voice.m4a",
});

const transcript = (fields: { audioHash?: string; inputHash?: string; hash?: string } = {}) => ({
	file: "transcript.json",
	hash: fields.hash ?? "t1",
	inputHash: fields.inputHash ?? "made-elsewhere",
	provider: "fake-transcriber",
	model: "whisper",
	language: "es",
	...(fields.audioHash === undefined ? {} : { audioHash: fields.audioHash }),
});

const post = (fields: Partial<Post> = {}): Post => ({
	manifestVersion: 1,
	slug: SLUG,
	createdAt: "2026-11-04T09:00:00.000Z",
	revision: 1,
	...fields,
});

const beat = (index: number, fields: Partial<Beat> = {}): Beat => ({
	index,
	start: index * 2,
	end: index * 2 + 2,
	text: `beat ${index}`,
	prompt: `prompt ${index}`,
	...fields,
});

/** A speech post whose transcript and beats were cut from its audio, as this version records. */
const planned = (items: ReadonlyArray<Beat>): Post => {
	const base = post({ audio: audio(), transcript: transcript({ audioHash: "a1" }) });
	const plan = planInputHash(base) ?? "";
	return { ...base, beats: { inputHash: plan, sourceHash: plan, items } };
};

/** Writes `file` in the post's folder, so it counts as there. */
const touch = (ctx: Context, file: string) => {
	const path = join(postDir(ctx, SLUG), file);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, "x");
};

/** Beat `index`'s generated image, made from its prompt and seed, with its file there. */
const generated = (ctx: Context, b: Beat, fields: { older?: boolean; model?: string } = {}) => {
	const file = `images/beat-0${b.index}.jpg`;
	touch(ctx, file);
	const seed = seedOf(SLUG, b);
	const model = fields.model ?? "fake-fast";
	return {
		...b,
		image: {
			file,
			hash: `i${b.index}`,
			inputHash: imageInputHash(ctx, model, b, seed),
			provider: "fake-images",
			model,
			seed,
			source: "generated" as const,
			// An image made before images recorded their prompt has none.
			...(fields.older ? {} : { prompt: b.prompt ?? "" }),
		},
	};
};

const freshness = (ctx: Context, p: Post) => run(freshnessOf(ctx, p));

describe("freshnessOf", () => {
	describe("transcript", () => {
		it("should be none without a transcript, and for music whatever it has", async () => {
			// GIVEN speech without a transcript, and music with one
			const ctx = testContext();

			// THEN both read as none
			expect((await freshness(ctx, post({ audio: audio() }))).transcript).toBe("none");
			const music = post({ audio: audio("a1", "music"), transcript: transcript() });
			expect((await freshness(ctx, music)).transcript).toBe("none");
		});

		it("should be current when it records the audio it was made from", async () => {
			// GIVEN a transcript that records the post's audio
			const ctx = testContext();
			const p = post({ audio: audio("a1"), transcript: transcript({ audioHash: "a1" }) });

			// THEN it's current
			expect((await freshness(ctx, p)).transcript).toBe("current");
		});

		it("should count a transcript as out of date after new audio", async () => {
			// GIVEN a transcript made from other audio than the post's
			const ctx = testContext();
			const p = post({ audio: audio("a2"), transcript: transcript({ audioHash: "a1" }) });

			// THEN it was made from other audio
			expect((await freshness(ctx, p)).transcript).toBe("other-audio");
		});

		it("should read an older transcript by its hash, detected or in the language it records", async () => {
			// GIVEN older transcripts of audio a1, detected and forced to Spanish
			const ctx = testContext();
			const older = (language: string) =>
				post({
					audio: audio("a1"),
					transcript: transcript({
						inputHash: hashOf("a1", "fake-transcriber", "whisper", language),
					}),
				});

			// THEN both are current, and one made from other audio isn't
			expect((await freshness(ctx, older("auto"))).transcript).toBe("current");
			expect((await freshness(ctx, older("es"))).transcript).toBe("current");
			const moved = { ...older("auto"), audio: audio("a2") };
			expect((await freshness(ctx, moved)).transcript).toBe("other-audio");
		});
	});

	describe("beats", () => {
		it("should be none without beats", async () => {
			// GIVEN a post with a transcript and no beats
			const ctx = testContext();
			const p = post({ audio: audio(), transcript: transcript({ audioHash: "a1" }) });

			// THEN beats are none, and not a re-cut
			const f = await freshness(ctx, p);
			expect(f.beats).toBe("none");
			expect(f.recut).toBe(false);
		});

		it("should be current when cut from the current transcript, and stale after it changed", async () => {
			// GIVEN beats cut from transcript t1
			const ctx = testContext();
			const p = planned([beat(0)]);

			// THEN they're current, until the transcript is made again with other words
			expect((await freshness(ctx, p)).beats).toBe("current");
			const remade = { ...p, transcript: transcript({ audioHash: "a1", hash: "t2" }) };
			expect((await freshness(ctx, remade)).beats).toBe("stale");
		});

		it("should count a re-cut of the current moments as current", async () => {
			// GIVEN beats re-cut by moment from the current transcript
			const ctx = testContext();
			const p = planned([beat(0, { moment: "hook" }), beat(1, { moment: "payoff" })]);
			const items = p.beats?.items ?? [];
			const recut = {
				...p,
				beats: {
					...(p.beats ?? { items }),
					inputHash: recutInputHash(p.beats?.sourceHash ?? "", items),
				},
			};

			// THEN they're current, and a re-cut
			const f = await freshness(ctx, recut);
			expect(f.beats).toBe("current");
			expect(f.recut).toBe(true);
		});

		it("should read older beats by their hash: a plain plan, a re-cut, and moments with an older transcript", async () => {
			// GIVEN older plans without sourceHash, next to an older transcript
			const ctx = testContext();
			const base = post({ audio: audio(), transcript: transcript() });
			const plan = planInputHash(base) ?? "";
			const withBeats = (inputHash: string, items: ReadonlyArray<Beat>) => ({
				...base,
				beats: { inputHash, items },
			});
			const moments = [beat(0, { moment: "hook" as const })];

			// THEN a plain plan, a re-cut and an edited plan with moments are current
			expect((await freshness(ctx, withBeats(plan, [beat(0)]))).beats).toBe("current");
			const recut = await freshness(ctx, withBeats(recutInputHash(plan, moments), moments));
			expect(recut).toMatchObject({ beats: "current", recut: true });
			expect((await freshness(ctx, withBeats("edited", moments))).beats).toBe("current");
			// AND a plan without moments cut from other words is stale
			expect((await freshness(ctx, withBeats("other", [beat(0)]))).beats).toBe("stale");
		});

		it("should count music's beats as stale after new audio", async () => {
			// GIVEN music beats cut from audio a1, with moments
			const ctx = testContext();
			const base = post({ audio: audio("a1", "music") });
			const plan = planInputHash(base) ?? "";
			const items = [beat(0, { moment: "hook" as const })];
			const p = { ...base, beats: { inputHash: plan, items } };

			// THEN they're current, until other music is imported
			expect((await freshness(ctx, p)).beats).toBe("current");
			expect((await freshness(ctx, { ...p, audio: audio("a2", "music") })).beats).toBe("stale");
		});
	});

	describe("images", () => {
		it("should list only the beats whose image needs work, and why", async () => {
			// GIVEN beat 0 up to date, beat 1 without an image, beat 2 in flight, beat 3 with a new
			// prompt, beat 4 with a new seed, and beat 5 whose file is gone
			const ctx = testContext();
			const pending = {
				provider: "fake-images",
				model: "fake-fast",
				requestId: "r2",
				statusUrl: "s",
				responseUrl: "r",
				inputHash: "h",
				seed: 1,
				ledgerId: "l",
			};
			const gone = generated(ctx, beat(5));
			const items = [
				generated(ctx, beat(0)),
				beat(1),
				{ ...beat(2), pending },
				{ ...generated(ctx, beat(3)), prompt: "a new prompt" },
				{ ...generated(ctx, beat(4)), seed: 99 },
				{ ...gone, image: { ...gone.image, file: "images/missing.jpg" } },
			];

			// WHEN its freshness is read
			const f = await freshness(ctx, planned(items));

			// THEN each beat that needs work is listed, with why
			expect(f.images).toEqual([
				{ beat: 1, imported: false, why: "none" },
				{ beat: 2, imported: false, why: "pending" },
				{ beat: 3, imported: false, why: "changed" },
				{ beat: 4, imported: false, why: "changed" },
				{ beat: 5, imported: false, why: "file-gone" },
			]);
		});

		it("should keep an imported image whatever its prompt, until its file is gone", async () => {
			// GIVEN an imported image whose file is there, and one whose file is gone
			const ctx = testContext();
			touch(ctx, "images/beat-00-imported.png");
			const imported = (file: string) => ({
				file,
				hash: "h",
				inputHash: "imported",
				provider: "import",
				model: "none",
				seed: 0,
				source: "imported" as const,
			});
			const p = planned([
				beat(0, { image: imported("images/beat-00-imported.png") }),
				beat(1, { image: imported("images/beat-01-imported.png") }),
			]);

			// THEN only the one whose file is gone is listed
			expect((await freshness(ctx, p)).images).toEqual([
				{ beat: 1, imported: true, why: "file-gone" },
			]);
		});

		it("should read an older image by its hash with today's brand style", async () => {
			// GIVEN an image made before images recorded their prompt
			const ctx = testContext();
			const older = generated(ctx, beat(0), { older: true });

			// THEN it's up to date, until its prompt changes
			expect((await freshness(ctx, planned([older]))).images).toEqual([]);
			const reprompted = { ...older, prompt: "another prompt" };
			expect((await freshness(ctx, planned([reprompted]))).images).toEqual([
				{ beat: 0, imported: false, why: "changed" },
			]);
		});

		it("should keep images up to date after config.json names another image model", async () => {
			// GIVEN images made with fake-fast, and config.json now naming fake-fine
			const ctx = testContext({ config: { image: { model: "fake-fine" } } });
			const p = planned([generated(ctx, beat(0)), generated(ctx, beat(1))]);

			// THEN no image needs work
			expect((await freshness(ctx, p)).images).toEqual([]);
		});
	});

	describe("draft", () => {
		/** A post with up-to-date images and a draft rendered from them. */
		const rendered = (ctx: Context, fields: { inputHash?: string; file?: string } = {}) => {
			const p = planned([generated(ctx, beat(0))]);
			touch(ctx, "draft.mp4");
			return {
				...p,
				draft: {
					file: fields.file ?? "draft.mp4",
					hash: "d1",
					inputHash: fields.inputHash ?? draftInputHash(ctx, p, RENDERER),
					rendererVersion: RENDERER,
					durationSec: 4,
				},
			};
		};

		it("should be none without a draft", async () => {
			// GIVEN a post without a draft
			const ctx = testContext();
			const f = await freshness(ctx, planned([beat(0)]));

			// THEN the draft is none, and there's nothing to export
			expect(f.draft).toBe("none");
			expect(f.exportMatches).toBe(false);
		});

		it("should be current when draft render would do nothing", async () => {
			// GIVEN a draft rendered from the post as it is
			const ctx = testContext();
			const f = await freshness(ctx, rendered(ctx));

			// THEN it's current, and the export matches it
			expect(f.draft).toBe("current");
			expect(f.exportMatches).toBe(true);
		});

		it("should be stale after its beats changed, or when its file is gone", async () => {
			// GIVEN a draft rendered from other beats, and one whose file is gone
			const ctx = testContext();
			const changed = await freshness(ctx, rendered(ctx, { inputHash: "other" }));
			const gone = await freshness(ctx, rendered(ctx, { file: "missing.mp4" }));

			// THEN both are stale; only the first doesn't match the export
			expect(changed).toMatchObject({ draft: "stale", exportMatches: false });
			expect(gone).toMatchObject({ draft: "stale", exportMatches: true });
		});
	});
});

describe("seedUpToDate", () => {
	it("should seed a post whose every output counts as up to date", async () => {
		// GIVEN a post seeded from withDraft() as up to date
		const ctx = testContext();
		const post = await seedUpToDate(ctx, SLUG, withDraft());

		// WHEN its freshness is read
		const f = await freshness(ctx, post);

		// THEN every output is current
		expect(f).toEqual(UP_TO_DATE);
	});
});
