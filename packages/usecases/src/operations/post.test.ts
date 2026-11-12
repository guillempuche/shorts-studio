import { type Post, Stage, stageOf } from "@shorts-studio/domain/post";
import { DateTime, Effect } from "effect";
import { describe, expect, it } from "vitest";
import { commandPath, flagName } from "../operation.ts";
import { readPost } from "../post-store.ts";
import { testContext } from "../test/context.ts";
import { run } from "../test/fakes.ts";
import { approvedAsIs, type PostFields, seedPost, withDraft } from "../test/posts.ts";
import { imageGenerate } from "./image.ts";
import { operations } from "./index.ts";
import { postArchive } from "./lifecycle.ts";
import { nextStepsOf, postCreate, postList, postShow } from "./post.ts";

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
		await seedPost(ctx, SLUG, fields);
		return { ctx, shown: await run(postShow.run({ post: SLUG }, ctx, MODE)) };
	};

	it("should name the agent's tool and its arguments next to the command", async () => {
		// GIVEN a post with audio but no transcript
		// WHEN it is shown
		const { shown } = await show({ audio });

		// THEN `next` is the command, and the first step is the same call as an MCP tool
		expect(shown.next).toBe(`audio transcribe --post ${SLUG}`);
		expect(shown.nextSteps[0]).toEqual({
			by: "agent",
			cli: `audio transcribe --post ${SLUG}`,
			tool: "audio_transcribe",
			args: { post: SLUG },
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
		await seedPost(ctx, SLUG, approvedAsIs({ script, audio, transcript, beats }));

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
		await seedPost(ctx, SLUG, approvedAsIs({ script, audio, transcript, beats }));

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

	it("should only name MCP tools the server offers, with their own fields and command", () => {
		// GIVEN the operations offered over MCP
		const tools = new Map(
			operations.filter((op) => op.surface === "cli-and-mcp").map((op) => [op.name, op]),
		);

		for (const fields of FIXTURES) {
			// WHEN the next steps of a post at each stage are worked out
			const post = postOf(fields);
			for (const step of nextStepsOf(post)) {
				const where = `${stageOf(post)}: ${step.cli ?? step.note}`;
				if (step.tool === undefined) {
					// THEN a step with no tool is the user's, or a note with nothing to run
					expect(step.args, where).toBeUndefined();
					continue;
				}
				// THEN its tool is one the server offers
				const op = tools.get(step.tool);
				expect(op, where).toBeDefined();
				// AND each argument is one of that tool's fields
				const fieldsOfTool = [...Object.keys(op?.params ?? {}), ...(op?.spends ? ["dryRun"] : [])];
				for (const key of Object.keys(step.args ?? {})) expect(fieldsOfTool, where).toContain(key);
				// AND its command is that operation's, with a flag for each argument
				expect(step.cli?.startsWith(commandPath(step.tool).join(" ")), where).toBe(true);
				for (const key of Object.keys(step.args ?? {})) {
					expect(step.cli, where).toContain(`--${flagName(key)}`);
				}
				// AND every value a shell or a tool can't take as it is is a placeholder it lists to fill
				for (const [key, value] of Object.entries(step.args ?? {})) {
					const placeholder = typeof value === "string" && /^<[^<>]+>$/.test(value);
					expect(step.fill?.includes(key) ?? false, `${where}: ${key}`).toBe(placeholder);
					if (!placeholder) expect(String(value), `${where}: ${key}`).not.toMatch(/[<>|]/);
				}
			}
		}
	});
});
