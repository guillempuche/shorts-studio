import { rmSync } from "node:fs";
import { join } from "node:path";
import type { Beat } from "@shorts-studio/domain/post";
import { mapBeats } from "@shorts-studio/domain/post";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { Context } from "../context.ts";
import { postDir, updatePost } from "../post-store.ts";
import { testContext } from "../test/context.ts";
import { fakeMediaTools, fakePorts, run, runFailure } from "../test/fakes.ts";
import { seedUpToDate, withDraft } from "../test/posts.ts";
import { draftRender } from "./draft.ts";

const SLUG = "2026-11-04-render";
const MODE = { dryRun: false, confirmed: true } as const;

/** A post with up-to-date images and no draft yet, and a renderer that records each render. */
const ready = async (ctx: Context) => {
	const { draft: _, ...noDraft } = withDraft();
	await seedUpToDate(ctx, SLUG, noDraft);
	const media = fakeMediaTools();
	return { media, ports: fakePorts({ mediaTools: media }) };
};

/** Changes beat `index` as `change` says, after its image was made. */
const changeBeat = (ctx: Context, index: number, change: (beat: Beat) => Beat) =>
	Effect.runPromise(
		updatePost(ctx, SLUG, "test", (post) =>
			Effect.succeed(mapBeats(post, (b) => (b.index === index ? change(b) : b))),
		),
	);

const render = (ctx: Context) => draftRender.run({ post: SLUG, force: false }, ctx, MODE);

describe("draft render", () => {
	it("should render a post whose parts are up to date", async () => {
		// GIVEN a post whose images match their prompts
		const ctx = testContext();
		const { media, ports } = await ready(ctx);

		// WHEN its draft is rendered
		const result = await run(render(ctx), ports);

		// THEN it renders
		expect(result.skipped).toBe(false);
		expect(media.renders).toHaveLength(1);
	});

	it("should refuse a beat whose prompt changed after its image, naming it", async () => {
		// GIVEN beat 1's prompt changed after its image was made
		const ctx = testContext();
		const { media, ports } = await ready(ctx);
		await changeBeat(ctx, 1, (b) => ({ ...b, prompt: "a green field" }));

		// WHEN its draft is rendered
		const error = await runFailure(render(ctx), ports);

		// THEN nothing is rendered, and it fails with stale, naming beat 1
		expect(error.code).toBe("stale");
		expect(error.message).toContain("beat 1");
		expect(media.renders).toHaveLength(0);
	});

	it("should refuse an image whose file is gone, naming how to make it again", async () => {
		// GIVEN beat 1's generated image file deleted
		const ctx = testContext();
		const { media, ports } = await ready(ctx);
		rmSync(join(postDir(ctx, SLUG), "images", "beat-01.jpg"));

		// WHEN its draft is rendered
		const error = await runFailure(render(ctx), ports);

		// THEN nothing is rendered, and it fails with not-found, naming the dry run for beat 1
		expect(error.code).toBe("not-found");
		expect(error.fix).toContain(`image generate --post ${SLUG} --beat 1 --dry-run`);
		expect(media.renders).toHaveLength(0);
	});

	it("should refuse a beat with an image request in flight, naming image generate", async () => {
		// GIVEN beat 0 with a request sent and not yet saved
		const ctx = testContext();
		const { media, ports } = await ready(ctx);
		await changeBeat(ctx, 0, (b) => ({
			...b,
			pending: {
				provider: "fake-images",
				model: "fake-fast",
				requestId: "req-1",
				statusUrl: "memory://req-1/status",
				responseUrl: "memory://req-1",
				inputHash: "h",
				seed: 1,
				ledgerId: "l1",
			},
		}));

		// WHEN its draft is rendered
		const error = await runFailure(render(ctx), ports);

		// THEN nothing is rendered, and it fails with stale, its fix naming image generate
		expect(error.code).toBe("stale");
		expect(error.message).toContain("without paying again");
		expect(error.fix).toContain("image generate");
		expect(media.renders).toHaveLength(0);
	});

	it("should render with the images it has after config.json names another image model", async () => {
		// GIVEN images made with fake-fast, and config.json now naming fake-fine
		const ctx = testContext({ config: { image: { model: "fake-fine" } } });
		const { media, ports } = await ready(ctx);

		// WHEN its draft is rendered
		await run(render(ctx), ports);

		// THEN it renders with them
		expect(media.renders).toHaveLength(1);
	});
});
