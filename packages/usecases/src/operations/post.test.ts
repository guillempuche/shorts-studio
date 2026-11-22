import { type Post, Stage, stageOf } from "@shorts-studio/domain/post";
import { DateTime, Effect } from "effect";
import { describe, expect, it } from "vitest";
import { type Freshness, UP_TO_DATE } from "../freshness.ts";
import { readPost } from "../post-store.ts";
import { testContext } from "../test/context.ts";
import { run } from "../test/fakes.ts";
import { approvedAsIs, type PostFields, seedPost, seedUpToDate, withDraft } from "../test/posts.ts";
import { expectValidStep } from "../test/steps.ts";
import { imageGenerate } from "./image.ts";
import { postArchive } from "./lifecycle.ts";
import { nextStepsOf, nextText, postCreate, postList, postShow } from "./post.ts";

const MODE = { dryRun: false, confirmed: true } as const;

describe("post create", () => {
	it("should put today's date in front of a slug that has none", async () => {
		// GIVEN today is 2026-11-04
		const ctx = testContext();

		// WHEN a post is created as "morning-routine"
		const created = await run(
			postCreate.run({ post: "morning-routine", title: undefined, notes: undefined }, ctx, MODE),
		);

		// THEN its slug starts with today's date
		expect(created.slug).toBe("2026-11-04-morning-routine");
	});

	it("should date a post made just after midnight by the local day", async () => {
		// GIVEN a machine in Madrid at 00:30 on 5 November, while UTC is still on 4 November
		const ctx = testContext({
			timeZone: DateTime.zoneMakeNamedUnsafe("Europe/Madrid"),
			now: () => new Date("2026-11-04T23:30:00Z"),
		});

		// WHEN a post is created as "morning-routine"
		const created = await run(
			postCreate.run({ post: "morning-routine", title: undefined, notes: undefined }, ctx, MODE),
		);

		// THEN its slug starts with the local day
		expect(created.slug).toBe("2026-11-05-morning-routine");
	});

	it("should take the slug's date and createdAt from one reading of the clock", async () => {
		// GIVEN a clock that passes midnight while the post is made
		let reads = 0;
		const instants = ["2026-11-04T23:59:59.999Z", "2026-11-05T00:00:00.000Z"];
		const ctx = testContext({ now: () => new Date(instants[Math.min(reads++, 1)] ?? "") });

		// WHEN a post is created as "late"
		const created = await run(
			postCreate.run({ post: "late", title: undefined, notes: undefined }, ctx, MODE),
		);

		// THEN its slug's date is the day of its createdAt
		const post = await Effect.runPromise(readPost(ctx, created.slug));
		expect(created.slug).toBe("2026-11-04-late");
		expect(post.createdAt).toBe("2026-11-04T23:59:59.999Z");
	});

	it("should keep a slug that already starts with a date", async () => {
		// GIVEN a context
		const ctx = testContext();

		// WHEN a post is created with a dated slug
		const created = await run(
			postCreate.run({ post: "2026-12-01-advent", title: undefined, notes: undefined }, ctx, MODE),
		);

		// THEN the slug is used as given
		expect(created.slug).toBe("2026-12-01-advent");
	});
});

describe("post list", () => {
	it("should list posts newest first, with their stage and title", async () => {
		// GIVEN an older post with a script and a newer one with a title
		const ctx = testContext();
		await seedPost(ctx, "2026-11-03-older", { script: { file: "script.md", hash: "h" } });
		await seedPost(ctx, "2026-11-04-newer", { brief: { title: "Newer" } });

		// WHEN posts are listed
		const { posts } = await run(postList.run({ stage: undefined }, ctx, MODE));

		// THEN the newer comes first, and each shows its stage
		expect(posts).toEqual([
			{ slug: "2026-11-04-newer", stage: "idea", title: "Newer" },
			{ slug: "2026-11-03-older", stage: "script-ready" },
		]);
	});

	it("should hide archived posts unless asked for that stage", async () => {
		// GIVEN one archived post and one in progress
		const ctx = testContext();
		await seedPost(ctx, "2026-11-04-done");
		await seedPost(ctx, "2026-11-04-doing");
		await run(postArchive.run({ post: "2026-11-04-done" }, ctx, MODE));

		// WHEN posts are listed, then listed by stage archived
		const all = await run(postList.run({ stage: undefined }, ctx, MODE));
		const archived = await run(postList.run({ stage: "archived" }, ctx, MODE));

		// THEN the plain list leaves the archived post out
		expect(all.posts.map((p) => p.slug)).toEqual(["2026-11-04-doing"]);
		// AND the archived list shows only it
		expect(archived.posts.map((p) => p.slug)).toEqual(["2026-11-04-done"]);
	});
});

describe("next steps", () => {
	const SLUG = "2026-11-04-steps";
	const audio = {
		file: "audio/audio.m4a",
		hash: "a",
		origin: "mine",
		kind: "speech",
		durationSec: 4,
		source: "recording.m4a",
	} as const;
	const transcript = {
		file: "transcript.json",
		hash: "t",
		inputHash: "ti",
		provider: "fake-transcriber",
		model: "fake",
		language: "en",
	};
	const script = { file: "script.md", hash: "s" };
	const beats = {
		inputHash: "b",
		items: [
			{ index: 0, start: 0, end: 2, text: "one", prompt: "a red door" },
			{ index: 1, start: 2, end: 4, text: "two", prompt: "a blue sky" },
		],
	};
	const show = async (fields: PostFields) => {
		const ctx = testContext();
		await seedUpToDate(ctx, SLUG, fields);
		return { ctx, shown: await run(postShow.run({ post: SLUG }, ctx, MODE)) };
	};

	it("should name the agent's tool and its arguments next to the command", async () => {
		// GIVEN a post with audio but no transcript
		// WHEN it is shown
		const { shown } = await show({ audio });

		// THEN `next` is the dry run's command, and the first step is the same call as an MCP tool
		expect(shown.next).toBe(`audio transcribe --post ${SLUG} --dry-run`);
		expect(shown.nextSteps[0]).toEqual({
			by: "agent",
			cli: `audio transcribe --post ${SLUG} --dry-run`,
			tool: "audio_transcribe",
			args: { post: SLUG, dryRun: true },
		});
	});

	it("should send a post ready for images to a dry run first", async () => {
		// GIVEN an approved script, transcribed audio and beats with prompts but no images
		// WHEN it is shown
		const { shown } = await show(approvedAsIs({ script, audio, transcript, beats }));

		// THEN the next step is the dry run, as a command and as a tool call
		expect(shown.next).toBe(`image generate --post ${SLUG} --dry-run`);
		expect(shown.nextSteps[0]).toMatchObject({
			by: "agent",
			tool: "image_generate",
			args: { post: SLUG, dryRun: true },
		});
	});

	it("should make the real run the next step after a dry run of images", async () => {
		// GIVEN a post ready for images
		const { ctx } = await show(approvedAsIs({ script, audio, transcript, beats }));

		// WHEN images are planned with a dry run
		const planned = await run(
			imageGenerate.run({ post: SLUG, beat: undefined, reroll: false, model: undefined }, ctx, {
				dryRun: true,
				confirmed: false,
			}),
		);

		// THEN the next step is the same call without dryRun, which needs --yes on the CLI
		expect(planned.nextSteps[0]).toMatchObject({
			by: "agent",
			tool: "image_generate",
			args: { post: SLUG },
			cli: `image generate --post ${SLUG} --yes`,
		});
	});

	it("should leave the next step to the user after a dry run that won't fit", async () => {
		// GIVEN a post ready for images, and a daily cap below what they cost
		const ctx = testContext({ config: { caps: { dailyUsd: 0.001 } } });
		await seedUpToDate(ctx, SLUG, approvedAsIs({ script, audio, transcript, beats }));

		// WHEN images are planned with a dry run
		const planned = await run(
			imageGenerate.run({ post: SLUG, beat: undefined, reroll: false, model: undefined }, ctx, {
				dryRun: true,
				confirmed: false,
			}),
		);

		// THEN the next step is the user's, naming the cap, not a real run that would be refused
		expect(planned.nextSteps[0]?.by).toBe("user");
		expect(planned.nextSteps[0]?.note).toContain("today's cap");
	});

	it("should quote an argument the shell would split", async () => {
		// GIVEN a post ready for images
		const ctx = testContext();
		await seedUpToDate(ctx, SLUG, approvedAsIs({ script, audio, transcript, beats }));

		// WHEN two beats are planned, written with a space after the comma
		const planned = await run(
			imageGenerate.run({ post: SLUG, beat: "0, 1", reroll: false, model: undefined }, ctx, {
				dryRun: true,
				confirmed: false,
			}),
		);

		// THEN the real run's command keeps the list as one word
		expect(planned.nextSteps[0]?.cli).toBe(`image generate --post ${SLUG} --beat '0, 1' --yes`);
	});

	it("should leave the user's approval to the user, with no tool to call", async () => {
		// GIVEN a post whose script waits for approval
		// WHEN it is shown
		const { shown } = await show({ script, audio, transcript, beats });

		// THEN the step is the user's, a command for their terminal and no MCP tool
		const [step] = shown.nextSteps;
		expect(step).toMatchObject({ by: "user", cli: `script approve --post ${SLUG}` });
		expect(step?.tool).toBeUndefined();
	});
});

describe("nextStepsOf", () => {
	const transcript = {
		file: "transcript.json",
		hash: "t",
		inputHash: "ti",
		provider: "fake-transcriber",
		model: "fake",
		language: "en",
	};
	const script = { file: "script.md", hash: "s" };
	const beats = (prompted: boolean) => ({
		inputHash: "b",
		items: [0, 1].map((index) => ({
			index,
			start: index * 2,
			end: index * 2 + 2,
			text: "words",
			...(prompted ? { prompt: "a red door" } : {}),
		})),
	});
	const { draft: _, ...imagesNoDraft } = withDraft();
	const drafted = { ...withDraft(), transcript };
	const reviewed = (decision: "approve" | "fix" | "reject") => ({
		...drafted,
		review: { decision, at: "2026-11-04T20:00:00.000Z", draftHash: "d1" },
	});
	const final = { file: "final.mp4", hash: "f", at: "2026-11-05T09:00:00.000Z" };
	const posted = [
		{ platform: "instagram", url: "https://x", at: "2026-11-05T10:00:00.000Z" },
	] as const;
	const audio = {
		file: "audio/audio.m4a",
		hash: "a",
		origin: "mine",
		kind: "speech",
		durationSec: 4,
		source: "recording.m4a",
	} as const;
	const FIXTURES: ReadonlyArray<PostFields> = [
		{},
		{ audio },
		{ audio, transcript },
		{ audio, transcript, beats: beats(false) },
		{ audio, transcript, beats: beats(true) },
		{ script, audio, transcript, beats: beats(true) },
		approvedAsIs({ script }),
		approvedAsIs({ script, audio, transcript, beats: beats(true) }),
		{ ...imagesNoDraft, transcript },
		drafted,
		reviewed("fix"),
		reviewed("reject"),
		reviewed("approve"),
		{ ...reviewed("approve"), final },
		{ ...reviewed("approve"), final, published: posted },
		{ ...reviewed("approve"), final, published: posted, archivedAt: "2026-11-06T09:00:00.000Z" },
	];
	const postOf = (fields: PostFields): Post => ({
		manifestVersion: 1,
		slug: "2026-11-04-walk",
		createdAt: "2026-11-04T09:00:00.000Z",
		revision: 1,
		...fields,
	});

	it("should cover every stage", () => {
		// GIVEN posts recorded at each point of the loop
		// WHEN their stages are worked out
		const stages = new Set(FIXTURES.map((fields) => stageOf(postOf(fields))));

		// THEN every stage is among them, so the next check walks them all
		expect([...stages].sort()).toEqual([...Stage.literals].sort());
	});

	/** Each kind of out-of-date output, one at a time. */
	const FRESHNESS: ReadonlyArray<readonly [string, Freshness]> = [
		["up to date", UP_TO_DATE],
		["transcript from other audio", { ...UP_TO_DATE, transcript: "other-audio" }],
		["no transcript", { ...UP_TO_DATE, transcript: "none" }],
		["stale beats", { ...UP_TO_DATE, beats: "stale" }],
		["re-cut beats", { ...UP_TO_DATE, recut: true }],
		...(["none", "changed", "pending", "file-gone"] as const).map(
			(why): readonly [string, Freshness] => [
				`an image ${why}`,
				{ ...UP_TO_DATE, images: [{ beat: 1, imported: false, why }] },
			],
		),
		[
			"an imported image gone",
			{ ...UP_TO_DATE, images: [{ beat: 0, imported: true, why: "file-gone" }] },
		],
		["a stale draft", { ...UP_TO_DATE, draft: "stale", exportMatches: false }],
	];

	it("should only name MCP tools the server offers, with their own fields and command", () => {
		for (const fields of FIXTURES) {
			for (const [what, freshness] of FRESHNESS) {
				// GIVEN a post at each stage, with each kind of out-of-date output
				const post = postOf(fields);
				// WHEN its next steps are worked out
				for (const step of nextStepsOf(post, freshness)) {
					// THEN each is the user's or a note, or names a tool the server offers, with that
					// tool's fields, its command, and a placeholder for each value to fill in
					expectValidStep(step, `${stageOf(post)}, ${what}: ${step.cli ?? step.note}`);
				}
			}
		}
	});

	it("should catch a step that names a tool the server doesn't offer", () => {
		// GIVEN a step naming a tool that doesn't exist
		const step = { by: "agent" as const, tool: "image_paint", cli: "image paint", args: {} };

		// WHEN it is checked
		// THEN the check fails on it
		expect(() => expectValidStep(step, "made up")).toThrow();
	});
});

describe("nextStepsOf, following what's out of date", () => {
	const SLUG = "2026-11-04-fresh";
	const audio = {
		file: "audio/audio.m4a",
		hash: "a",
		origin: "mine",
		kind: "speech",
		durationSec: 4,
		source: "recording.m4a",
	} as const;
	const transcript = {
		file: "transcript.json",
		hash: "t",
		inputHash: "ti",
		provider: "fake-transcriber",
		model: "fake",
		language: "en",
	};
	const script = { file: "script.md", hash: "s" };
	const beatsWith = (fields: { prompt?: boolean; moment?: boolean } = {}) => ({
		inputHash: "b",
		items: [0, 1].map((index) => ({
			index,
			start: index * 2,
			end: index * 2 + 2,
			text: "words",
			...(fields.prompt ? { prompt: `prompt ${index}` } : {}),
			...(fields.moment ? { moment: index === 0 ? ("hook" as const) : ("payoff" as const) } : {}),
		})),
	});
	const postOf = (fields: PostFields): Post => ({
		manifestVersion: 1,
		slug: SLUG,
		createdAt: "2026-11-04T09:00:00.000Z",
		revision: 1,
		...fields,
	});
	const review = (decision: "approve" | "fix" | "reject", extra = {}) => ({
		review: { decision, at: "2026-11-04T20:00:00.000Z", draftHash: "d1", ...extra },
	});
	const withImages = approvedAsIs({
		script,
		audio,
		transcript,
		beats: beatsWith({ prompt: true }),
	});

	it("should send new audio after the beats to a transcription dry run", () => {
		// GIVEN a post whose transcript was made from other audio than the new one
		const post = postOf({ audio, transcript, beats: beatsWith({ prompt: true }) });

		// WHEN its steps are worked out
		const [step] = nextStepsOf(post, { ...UP_TO_DATE, transcript: "other-audio" });

		// THEN the first is the transcription's dry run
		expect(step).toMatchObject({ tool: "audio_transcribe", args: { post: SLUG, dryRun: true } });
	});

	it("should plan beats cut from an earlier transcript again, saying how many prompts it drops", () => {
		// GIVEN beats with two prompts cut from an earlier transcript
		const post = postOf({ audio, transcript, beats: beatsWith({ prompt: true }) });

		// WHEN its steps are worked out
		const [step] = nextStepsOf(post, { ...UP_TO_DATE, beats: "stale" });

		// THEN the first plans again with force, and its note counts the prompts it drops
		expect(step).toMatchObject({ tool: "beat_plan", args: { post: SLUG, force: true } });
		expect(step?.note).toContain("drops their 2 prompts");
	});

	it("should send a music post to beat plan, with no step that transcribes it", () => {
		// GIVEN a music post without a transcript or beats
		const post = postOf({ audio: { ...audio, kind: "music" } });

		// WHEN its steps are worked out
		const steps = nextStepsOf(post, { ...UP_TO_DATE, transcript: "none", beats: "none" });

		// THEN the next step is beat plan, and nothing transcribes
		expect(nextText(steps)).toBe(`beat plan --post ${SLUG}`);
		expect(steps.some((step) => step.tool === "audio_transcribe")).toBe(false);
	});

	it("should offer the re-cut by moment when beats have moments and no prompts", () => {
		// GIVEN beats with story moments and no prompts, not re-cut yet
		const post = postOf({ audio, transcript, beats: beatsWith({ moment: true }) });

		// WHEN its steps are worked out
		const steps = nextStepsOf(post, UP_TO_DATE);

		// THEN the re-cut comes first, and writing the prompts is the alternative
		expect(steps[0]).toMatchObject({ tool: "beat_plan", args: { post: SLUG, byMoment: true } });
		expect(steps[1]).toMatchObject({ tool: "beat_set", or: true });
		// AND once re-cut, only the prompts are left
		expect(nextStepsOf(post, { ...UP_TO_DATE, recut: true })[0]?.tool).toBe("beat_set");
	});

	it("should name only the beat whose prompt changed after its image", () => {
		// GIVEN an approved post whose beat 1's prompt changed after its image
		const post = postOf(withImages);

		// WHEN its steps are worked out
		const steps = nextStepsOf(post, {
			...UP_TO_DATE,
			images: [{ beat: 1, imported: false, why: "changed" }],
		});

		// THEN the next step is the images dry run for beat 1
		expect(nextText(steps)).toBe(`image generate --post ${SLUG} --beat 1 --dry-run`);
	});

	it("should name a beat with a request in flight, and one whose file is gone", () => {
		// GIVEN an approved post whose beat 0 has a request in flight, then one whose file is gone
		const post = postOf(withImages);
		const stepFor = (why: "pending" | "file-gone", beat: number) =>
			nextStepsOf(post, { ...UP_TO_DATE, images: [{ beat, imported: false, why }] })[0];

		// THEN each first step is the images dry run for that beat alone
		expect(stepFor("pending", 0)).toMatchObject({
			tool: "image_generate",
			args: { post: SLUG, beat: "0", dryRun: true },
		});
		expect(stepFor("file-gone", 1)).toMatchObject({
			tool: "image_generate",
			args: { post: SLUG, beat: "1", dryRun: true },
		});
	});

	it("should name image import for an imported image whose file is gone", () => {
		// GIVEN an approved post whose beat 1's imported image file is gone
		const post = postOf(withImages);

		// WHEN its steps are worked out
		const steps = nextStepsOf(post, {
			...UP_TO_DATE,
			images: [{ beat: 1, imported: true, why: "file-gone" }],
		});

		// THEN the step is a note naming image import for beat 1, and nothing generates
		expect(steps).toHaveLength(1);
		expect(steps[0]?.note).toContain(`image import --post ${SLUG} --beat 1`);
		expect(steps[0]?.tool).toBeUndefined();
	});

	it("should render a draft out of date before its review, then leave the review to the user", () => {
		// GIVEN a draft whose beats changed before the user reviewed it
		const post = postOf(withDraft());

		// WHEN its steps are worked out
		const steps = nextStepsOf(post, { ...UP_TO_DATE, draft: "stale", exportMatches: false });

		// THEN the draft is rendered first, and the user's review comes after
		expect(steps[0]?.tool).toBe("draft_render");
		expect(steps.at(-1)).toMatchObject({ by: "user", cli: expect.stringContaining("post review") });
	});

	it("should render an approved draft whose beats changed, not export it", () => {
		// GIVEN an approved draft whose beats changed after the approval
		const post = postOf({ ...withDraft(), ...review("approve") });

		// WHEN its steps are worked out
		const steps = nextStepsOf(post, { ...UP_TO_DATE, draft: "stale", exportMatches: false });

		// THEN the first step renders it, and nothing exports
		expect(steps[0]?.tool).toBe("draft_render");
		expect(steps.some((step) => step.tool === "capcut_export")).toBe(false);
	});

	it("should put each of the user's notes first when they asked for fixes", () => {
		// GIVEN a review asking for fixes, with notes on beats 1 and 3
		const post = postOf({
			...withDraft(),
			...review("fix", {
				beatNotes: [
					{ beat: 1, note: "too dark" },
					{ beat: 3, note: "wrong face" },
				],
			}),
		});

		// WHEN its steps are worked out
		const steps = nextStepsOf(post, UP_TO_DATE);

		// THEN the first steps are the agent's, one per note, each naming its beat, note and tools
		expect(steps[0]).toMatchObject({ by: "agent" });
		expect(steps[0]?.note).toContain('beat 1: "too dark"');
		expect(steps[0]?.note).toContain("image generate");
		expect(steps[1]?.note).toContain('beat 3: "wrong face"');
		// AND, while nothing has changed, a note says to render the draft once the fixes are made,
		// since rendering now would do nothing
		expect(steps[2]?.tool).toBeUndefined();
		expect(steps[2]?.note).toContain(`draft render --post ${SLUG}`);
		// AND once a fix changed the draft's inputs, draft render comes after the notes
		const fixed = nextStepsOf(post, { ...UP_TO_DATE, draft: "stale", exportMatches: false });
		expect(fixed[2]?.tool).toBe("draft_render");
	});

	it("should keep the notes in front of the images dry run after a fix", () => {
		// GIVEN a review asking for fixes, and beat 1's prompt changed and approved since
		const post = postOf({
			...withDraft(),
			...review("fix", { beatNotes: [{ beat: 1, note: "too dark" }] }),
		});

		// WHEN its steps are worked out
		const steps = nextStepsOf(post, {
			...UP_TO_DATE,
			images: [{ beat: 1, imported: false, why: "changed" }],
		});

		// THEN the note comes first, then the images dry run
		expect(steps[0]?.note).toContain('beat 1: "too dark"');
		expect(steps[1]).toMatchObject({ tool: "image_generate", args: { beat: "1", dryRun: true } });
	});

	it("should leave a rejected draft to the user, to rework or archive", () => {
		// GIVEN a draft the user rejected
		const post = postOf({ ...withDraft(), ...review("reject") });

		// WHEN its steps are worked out
		const steps = nextStepsOf(post, UP_TO_DATE);

		// THEN the step is the user's, asking whether to rework or archive, with no tool
		expect(steps).toHaveLength(1);
		expect(steps[0]).toMatchObject({ by: "user" });
		expect(steps[0]?.note).toContain("rework");
		expect(steps[0]?.tool).toBeUndefined();
	});

	it("should offer publishing or archiving a published post, whatever is out of date before", () => {
		// GIVEN a published post whose beat 1's image no longer matches its prompt
		const post = postOf({
			...withDraft(),
			...review("approve"),
			final: { file: "final.mp4", hash: "f", at: "2026-11-05T09:00:00.000Z" },
			published: [{ platform: "instagram", url: "https://x", at: "2026-11-05T10:00:00.000Z" }],
		});

		// WHEN its steps are worked out
		const steps = nextStepsOf(post, {
			...UP_TO_DATE,
			images: [{ beat: 1, imported: false, why: "changed" }],
		});

		// THEN they're publishing on another platform, or archiving
		expect(steps.map((step) => step.tool)).toEqual(["post_publish", "post_archive"]);
	});

	it("should have no steps for an archived post, and say it's archived", () => {
		// GIVEN an archived post
		const post = postOf({ ...withDraft(), archivedAt: "2026-11-06T09:00:00.000Z" });

		// WHEN its steps are worked out
		const steps = nextStepsOf(post, { ...UP_TO_DATE, draft: "stale" });

		// THEN there are none, and the text says the post is archived
		expect(steps).toEqual([]);
		expect(nextText(steps)).toContain("archived");
	});

	it("should print the user's review in post show's text", async () => {
		// GIVEN a review asking for fixes, with "too dark" on beat 1
		const ctx = testContext();
		await seedUpToDate(ctx, SLUG, {
			...withDraft(),
			...review("fix", { beatNotes: [{ beat: 1, note: "too dark" }] }),
		});

		// WHEN it is shown as text
		const text = postShow.render?.(await run(postShow.run({ post: SLUG }, ctx, MODE))) ?? "";

		// THEN the text shows the decision, and beat 1's note
		expect(text).toContain("review: fix");
		expect(text).toContain("beat 1: too dark");
	});

	it("should keep images up to date after config.json names another image model", async () => {
		// GIVEN a post whose images were made with fake-fast, and config.json naming fake-fine
		const ctx = testContext({ config: { image: { model: "fake-fine" } } });
		const { draft: _, ...noDraft } = withDraft();
		await seedUpToDate(ctx, SLUG, noDraft);

		// WHEN it is shown
		const shown = await run(postShow.run({ post: SLUG }, ctx, MODE));

		// THEN the next step renders the draft, not images
		expect(shown.next).toBe(`draft render --post ${SLUG}`);
	});
});
