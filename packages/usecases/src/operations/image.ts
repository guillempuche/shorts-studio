/**
 * `image generate`: one image per beat, from the beat's prompt and the brand's style suffix.
 *
 * It spends money, so it needs the approved script (the morning check), `--yes` on the CLI,
 * and room under the spending caps. Each paid call is reserved in the ledger before it is sent.
 * The provider's request is saved in post.json before waiting for the image. So if a run is cut
 * short, the next run picks that request up again instead of paying twice. Beats whose image is
 * already up to date are skipped. `--reroll` gives the chosen beats a new seed.
 *
 * One real run at a time makes a post's images (`images.lock`), and it fetches every saved
 * request before it sends a new one. No command drops a saved request before it's fetched.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { fail, failBecause, RequestEnded, type ShortsError } from "@shorts-studio/domain/errors";
import { imageAmount } from "@shorts-studio/domain/models";
import {
	type Beat,
	changesSinceApproval,
	isScriptApproved,
	mapBeats,
	type Post,
	withoutPending,
} from "@shorts-studio/domain/post";
import { Effect, Fiber, Schema } from "effect";
import type { Context } from "../context.ts";
import { ensureDir, hashBytes, writeFileAtomic } from "../files.ts";
import { fullPrompt, imageInputHash, rerolledSeed, seedOf } from "../freshness.ts";
import { beatsOfPost, requireKey } from "../inputs.ts";
import {
	Budget,
	budgetFor,
	budgetLine,
	release,
	releaseIfNothingBilled,
	reserve,
	settingsRefusal,
	settle,
} from "../ledger.ts";
import { busyPost, withLock } from "../lock.ts";
import { chooseModel, costOf, type NamedModel } from "../models.ts";
import { roundUsd, usd } from "../money.ts";
import { defineOperation, p, type RunMode } from "../operation.ts";
import { ImageMaker, type ImageRequest } from "../ports.ts";
import { postDir, readPost, refuseArchived, updatePost } from "../post-store.ts";
import { agentStep, userStep } from "../steps.ts";
import { NextFields, nextAfterDryRun, nextOf } from "./post.ts";

type Maker = ImageMaker["Service"];

/** How many beats are generated at once. */
const CONCURRENCY = 3;

/** How long sending one request may take. A Ctrl-C waits up to this for the answer to save. */
const SUBMIT_DEADLINE = "60 seconds";

/** What one image at `IMAGE_SIZE` costs with `model`. */
const imageCost = (model: NamedModel) => costOf(model, imageAmount(model));

/** `beat 4`, or `beats 1, 4`. */
const beatsNamed = (beats: ReadonlyArray<number>): string =>
	beats.length === 1 ? `beat ${beats[0]}` : `beats ${beats.join(", ")}`;

/**
 * The free fetch of `beats`' saved requests: its `args`, its command, and what it does. A saved
 * request is fetched whatever model sent it; `model` is the one the run plans with, so the fetch
 * doesn't then plan new images with another one.
 */
const freeFetch = (slug: string, beats: ReadonlyArray<number>, model?: string) => {
	const beatList = beats.join(",");
	return {
		args: { post: slug, beat: beatList, ...(model === undefined ? {} : { model }) },
		cli: `image generate --post ${slug} --beat ${beatList}${model === undefined ? "" : ` --model ${model}`}`,
		what: `fetches ${beats.length === 1 ? "the image" : `the ${beats.length} images`} already paid for, at no cost`,
	};
};

/**
 * Whether fetching `beat`'s saved request with the model that sent it also makes a new image: its
 * prompt, seed or style changed since the request was sent, and its image doesn't fit either.
 */
const fetchAlsoGenerates = (ctx: Context, slug: string, beat: Beat): boolean => {
	if (beat.pending === undefined || beat.prompt === undefined) return false;
	const hash = imageInputHash(ctx, beat.pending.model, beat, seedOf(slug, beat));
	return (
		beat.pending.inputHash !== hash &&
		beat.image?.inputHash !== hash &&
		beat.image?.source !== "imported"
	);
};

/**
 * How a refusal's fix fetches `beats`' saved requests: one command per model that sent them, so
 * none plans a new image with another model. It says when a beat changed since its request, since
 * the same run then also pays for a new image.
 */
export const fetchSavedFix = (ctx: Context, slug: string, beats: ReadonlyArray<Beat>) => {
	const saved = beats.filter((beat) => beat.pending !== undefined);
	const models = [...new Set(saved.map((beat) => beat.pending?.model ?? ""))];
	const cli = models
		.map(
			(model) =>
				freeFetch(
					slug,
					saved.filter((beat) => beat.pending?.model === model).map((beat) => beat.index),
					model,
				).cli,
		)
		.join(", then ");
	const changed = saved.filter((beat) => fetchAlsoGenerates(ctx, slug, beat)).map((b) => b.index);
	const fetches = `fetches ${saved.length === 1 ? "the image" : `the ${saved.length} images`} already paid for`;
	return {
		cli,
		what:
			changed.length === 0
				? `${fetches}, at no cost`
				: `${fetches}, and pays for a new one for ${beatsNamed(changed)}, changed since its request: check its estimate with a dry run first`,
	};
};

/** The free fetch as an agent's step, without `--yes`: it pays for nothing, so it confirms nothing. */
const freeFetchStep = (slug: string, beats: ReadonlyArray<number>, model?: string) => {
	const fetch = freeFetch(slug, beats, model);
	return agentStep("image_generate", fetch.args, { note: fetch.what });
};

/**
 * Runs `use` holding the post's `images.lock`, so one run at a time makes a post's images and two
 * can't both pay for one beat. It's taken before post.json's or the ledger's lock, never while
 * holding them, so the three can't deadlock.
 */
export const withImagesLock = <A, E, R>(
	ctx: Context,
	slug: string,
	command: string,
	use: Effect.Effect<A, E, R>,
) =>
	withLock(join(postDir(ctx, slug), "images.lock"), command, busyPost(slug), use, {
		processStartedAt: ctx.processStartedAt,
	});

const Planned = Schema.Struct({
	beat: Schema.Int,
	action: Schema.Literals(["generate", "resume", "skip"]),
	estimateUsd: Schema.Finite,
	/**
	 * The beat's saved request was sent for an earlier prompt, seed, model or style. It's paid
	 * for, so it's fetched first, at no cost; `action` says what the beat needs after that.
	 */
	fetchesSaved: Schema.optionalKey(Schema.Literal(true)),
});

/** What a run does with one chosen beat, and the seed it makes the image with. */
interface Step {
	readonly beat: Beat;
	readonly seed: number;
	readonly action: (typeof Planned.Type)["action"];
	/** Its saved request no longer fits the plan, but is fetched first all the same. */
	readonly fetchesSaved: boolean;
}

/**
 * Sends one beat's request and saves it, with the new seed of a reroll, in the same write.
 *
 * Reserving, sending and saving finish together, in a fiber nothing interrupts: stopped mid-send,
 * the request would be paid for and lost. On Ctrl-C the run says it waits for the provider's
 * answer, then saves it, so the next run resumes the request instead of paying for it again. The
 * deadline keeps that wait short if the provider never answers.
 */
const sendRequest = Effect.fn("sendRequest")(function* (
	ctx: Context,
	maker: Maker,
	model: NamedModel,
	slug: string,
	{ beat, seed }: Step,
	inputHash: string,
) {
	const sending = yield* Effect.forkChild(
		Effect.gen(function* () {
			const ledgerId = yield* reserve(ctx, {
				...imageCost(model),
				post: slug,
				note: `beat ${beat.index}`,
			});
			const submitted = yield* maker.submit(model, fullPrompt(ctx, beat.prompt ?? ""), seed).pipe(
				Effect.timeoutOrElse({
					duration: SUBMIT_DEADLINE,
					orElse: () =>
						Effect.fail(
							fail(
								"provider",
								`The image provider didn't answer beat ${beat.index}'s request within ${SUBMIT_DEADLINE}.`,
								`The request may have been taken, so its cost stays counted, and running it again pays for a new one. Run image generate --post ${slug} --yes again later.`,
							),
						),
				}),
				Effect.tapError((error) => releaseIfNothingBilled(ctx, ledgerId, error)),
			);
			const sent = { ...submitted, ledgerId };
			// The seed is saved only with its request: a reroll stopped before sending keeps the old one.
			yield* updatePost(ctx, slug, "image generate", (post) =>
				Effect.succeed(
					withBeat(post, beat.index, (b) => ({
						...b,
						seed,
						pending: { provider: maker.provider, model: model.name, inputHash, seed, ...sent },
					})),
				),
			);
			ctx.log(`beat ${beat.index}: submitted (${submitted.requestId})`);
			return sent;
		}),
		{ uninterruptible: true },
	);
	return yield* Fiber.join(sending).pipe(
		Effect.onInterrupt(() =>
			Effect.sync(() =>
				ctx.log(
					`beat ${beat.index}: waiting up to ${SUBMIT_DEADLINE} for the provider's answer, so its request is saved and not paid for twice`,
				),
			).pipe(Effect.andThen(Fiber.await(sending)), Effect.asVoid),
		),
	);
});

/** What an image was made from, as the beat records it. */
interface MadeWith {
	readonly inputHash: string;
	readonly provider: string;
	readonly model: string;
	readonly seed: number;
	/** The beat's prompt, without the brand's style; unknown for a request sent for an older one. */
	readonly prompt?: string;
}

/**
 * Fetches a sent request's image and records it on the beat as `made`, then settles the request's
 * reservation. Without `made`, the beat keeps the image it has: the request is only settled.
 */
const collectAndSave = Effect.fn("collectAndSave")(function* (
	ctx: Context,
	maker: Maker,
	slug: string,
	index: number,
	request: ImageRequest & { readonly ledgerId: string },
	made: MadeWith | undefined,
) {
	const forgetRequest = release(ctx, request.ledgerId).pipe(
		Effect.andThen(
			updatePost(ctx, slug, "image generate", (post) =>
				Effect.succeed(withBeat(post, index, withoutPending)),
			),
		),
		Effect.ignore,
	);
	const bytes = yield* maker.collect(request).pipe(
		// The provider ended this request without an image, so it will never finish: forget it
		// and free the reservation.
		Effect.catchReason("ShortsError", "RequestEnded", (reason) =>
			forgetRequest.pipe(
				Effect.andThen(
					failBecause(
						new RequestEnded({
							message: reason.message,
							fix: `Run image generate --post ${slug} --yes to send a new request.`,
						}),
					),
				),
			),
		),
		// The fix leaves out --reroll: running again with it would pick a new seed and pay again.
		Effect.mapError((error) =>
			error.reason._tag === "ProviderFailed"
				? fail(
						"provider",
						error.message,
						`Run image generate --post ${slug} --yes (without --reroll): it resumes this request.`,
					)
				: error,
		),
	);

	const file = join("images", `beat-${String(index).padStart(2, "0")}.jpg`);
	if (made !== undefined) {
		yield* Effect.andThen(
			ensureDir(join(postDir(ctx, slug), "images")),
			writeFileAtomic(join(postDir(ctx, slug), file), bytes),
		).pipe(
			// The image is paid for and its request is still saved, so the next run fetches it free.
			Effect.mapError((error) =>
				fail(
					"failed",
					error.message,
					`Free some disk space or fix the folder's permissions, then run image generate --post ${slug} --yes: it fetches the paid image again without paying.`,
				),
			),
		);
	}

	yield* updatePost(ctx, slug, "image generate", (post) =>
		Effect.succeed(
			withBeat(post, index, (b) =>
				made === undefined
					? withoutPending(b)
					: {
							...withoutPending(b),
							seed: made.seed,
							image: { file, hash: hashBytes(bytes), ...made, source: "generated" as const },
						},
			),
		),
	);

	// The image is saved, so a ledger that can't be closed mustn't fail the run: an open
	// reservation counts the same amount as a settled one.
	yield* Effect.ignore(settle(ctx, request.ledgerId, request.requestId));
	ctx.log(
		made === undefined
			? `beat ${index}: fetched request ${request.requestId}, and kept the image it has`
			: `beat ${index}: saved ${file}`,
	);
});

/**
 * Fetches a beat's saved request, whatever its plan: it's paid for. One sent for an earlier
 * prompt, seed, model or style becomes the beat's image as it was made, and the plan then sends
 * a new request if that one no longer fits. A beat whose image already fits keeps it.
 */
const fetchSaved = (ctx: Context, maker: Maker, slug: string, step: Step) => {
	const saved = step.beat.pending;
	if (saved === undefined) return Effect.void;
	ctx.log(`beat ${step.beat.index}: resuming request ${saved.requestId}`);
	const { inputHash, provider, model, seed } = saved;
	return collectAndSave(
		ctx,
		maker,
		slug,
		step.beat.index,
		saved,
		step.action === "skip"
			? undefined
			: {
					inputHash,
					provider,
					model,
					seed,
					// A resumed request was sent for the beat's prompt as it is; an older one's is unknown.
					...(step.action === "resume" && step.beat.prompt !== undefined
						? { prompt: step.beat.prompt }
						: {}),
				},
	);
};

/** Sends a new request for one beat, then fetches its image and records it. */
const generateOne = Effect.fn("generateOne")(function* (
	ctx: Context,
	maker: Maker,
	model: NamedModel,
	slug: string,
	step: Step,
) {
	const inputHash = imageInputHash(ctx, model.name, step.beat, step.seed);
	const request = yield* sendRequest(ctx, maker, model, slug, step, inputHash);
	yield* collectAndSave(ctx, maker, slug, step.beat.index, request, {
		inputHash,
		provider: maker.provider,
		model: model.name,
		seed: step.seed,
		prompt: step.beat.prompt ?? "",
	});
});

const withBeat = (post: Post, index: number, change: (beat: Beat) => Beat): Post =>
	mapBeats(post, (b) => (b.index === index ? change(b) : b));

/** Fails unless the user approved the post as it stands and every beat can be made. */
const checkReady = (ctx: Context, post: Post, slug: string) => {
	if (!isScriptApproved(post)) {
		const changed = changesSinceApproval(post);
		return Effect.fail(
			fail(
				"needs-approval",
				changed.length === 0
					? `${slug}'s script isn't approved, so nothing will be spent on images yet.`
					: `${slug} changed since the user approved it (${changed.join(", ")}), so nothing will be spent on images yet.`,
				`Ask the user to read it and approve it in their own terminal: script approve --post ${slug}`,
				[userStep(`script approve --post ${slug}`, "the user's decision, in their own terminal")],
			),
		);
	}
	const beats = post.beats?.items ?? [];
	const withoutPrompt = beats
		.filter((b) => b.prompt === undefined && b.image?.source !== "imported")
		.map((b) => b.index);
	if (beats.length === 0 || withoutPrompt.length > 0) {
		return Effect.flatMap(nextOf(ctx, post), ({ next, nextSteps }) =>
			Effect.fail(
				fail(
					"not-found",
					beats.length === 0
						? `${slug} has no beats.`
						: `Beats without a prompt: ${withoutPrompt.join(", ")}.`,
					next,
					nextSteps,
				),
			),
		);
	}
	return Effect.void;
};

/**
 * Refuses to reroll a beat whose request is saved but not fetched: the reroll would drop an image
 * already paid for, and a reroll run again after Ctrl-C would pay a third time.
 */
const checkRerollable = (
	ctx: Context,
	chosen: ReadonlyArray<Beat>,
	slug: string,
): Effect.Effect<void, ShortsError> => {
	const waiting = chosen.filter((b) => b.pending !== undefined);
	const saved = waiting.map((b) => b.index);
	if (saved.length === 0) return Effect.void;
	const fetch = fetchSavedFix(ctx, slug, waiting);
	const one = saved.length === 1;
	const named = beatsNamed(saved);
	return Effect.fail(
		fail(
			"conflict",
			`${named.charAt(0).toUpperCase()}${named.slice(1)} ${one ? "has a request" : "have requests"} already paid for and not fetched yet, so nothing was rerolled.`,
			`Run ${fetch.cli} without --reroll first: it ${fetch.what}. Then reroll ${one ? "it" : "them"}.`,
		),
	);
};

/**
 * Refuses a beat whose saved request another image provider holds: this one can't fetch it, and
 * sending a new request would drop it.
 */
const checkFetchable = (
	ctx: Context,
	chosen: ReadonlyArray<Beat>,
	maker: Maker,
	slug: string,
): Effect.Effect<void, ShortsError> => {
	const elsewhere = chosen.find(
		(b) => b.pending !== undefined && b.pending.provider !== maker.provider,
	);
	if (elsewhere?.pending === undefined) return Effect.void;
	const { provider } = elsewhere.pending;
	const fetch = fetchSavedFix(ctx, slug, [elsewhere]);
	return Effect.fail(
		fail(
			"conflict",
			`Beat ${elsewhere.index} has a request already paid for with ${provider}, not ${maker.provider}, the image provider in use, so nothing was sent.`,
			`Set image.provider to ${provider} in config.json, then run ${fetch.cli}: it ${fetch.what}.`,
		),
	);
};

/**
 * Plans each chosen beat: resume its saved request, generate it, or skip it. A saved request that
 * no longer fits is still fetched first (`fetchesSaved`). A reroll plans the next seed, and saves
 * it only with the new request.
 */
const planOf = (
	ctx: Context,
	model: NamedModel,
	post: Post,
	chosen: ReadonlyArray<Beat>,
	reroll: boolean,
): ReadonlyArray<Step> =>
	chosen.map((beat) => {
		const seed = reroll ? rerolledSeed(post.slug, beat) : seedOf(post.slug, beat);
		const inputHash = imageInputHash(ctx, model.name, beat, seed);
		// An imported image (Midjourney, a photo) stays unless the beat is rerolled. A beat
		// without a prompt (allowed only with an imported image) is never sent, rerolled or not.
		const keepsImported = beat.image?.source === "imported" && !reroll;
		const resumes = beat.pending?.inputHash === inputHash;
		// A generated image whose file is gone is made again, with the same seed.
		const fileThere =
			beat.image === undefined || existsSync(join(postDir(ctx, post.slug), beat.image.file));
		const action =
			beat.prompt === undefined
				? "skip"
				: resumes
					? "resume"
					: keepsImported || (beat.image?.inputHash === inputHash && fileThere)
						? "skip"
						: "generate";
		return { beat, seed, action, fetchesSaved: beat.pending !== undefined && !resumes };
	});

/**
 * Over a cap part-way, the error also names the beats saved before it stopped, and those whose
 * request is paid for but not fetched, with the free fetch for them. Its code stays `over-budget`.
 */
const stoppedByCap = (
	ctx: Context,
	slug: string,
	stopped: { readonly message: string; readonly fix: string },
	finished: ReadonlyArray<number>,
): Effect.Effect<never, ShortsError> =>
	readPost(ctx, slug).pipe(
		Effect.map((post) => (post.beats?.items ?? []).filter((b) => b.pending !== undefined)),
		// Unreadable now, it can't say more than the cap's own error.
		Effect.orElseSucceed((): ReadonlyArray<Beat> => []),
		Effect.flatMap((waiting) => {
			const pending = waiting.map((b) => b.index);
			const done = [...finished].sort((a, b) => a - b);
			const fetch = fetchSavedFix(ctx, slug, waiting);
			return Effect.fail(
				fail(
					"over-budget",
					[
						stopped.message,
						done.length === 0
							? "No image was saved before it stopped."
							: `Saved before it stopped: ${beatsNamed(done)}.`,
						...(pending.length === 0
							? []
							: [`Paid for but not fetched yet: ${beatsNamed(pending)}.`]),
					].join(" "),
					pending.length === 0 ? stopped.fix : `${stopped.fix} Run ${fetch.cli}: it ${fetch.what}.`,
				),
			);
		}),
	);

/**
 * The real run of what a dry run planned: the same call without `dryRun`. On the CLI it takes
 * `--yes` only when it pays: `--yes` would also confirm a paid run if the post changed meanwhile.
 */
const realRunOf = (
	slug: string,
	input: {
		readonly beat?: string | undefined;
		readonly reroll: boolean;
		readonly model?: string | undefined;
	},
	pays: boolean,
) =>
	agentStep(
		"image_generate",
		{
			post: slug,
			...(input.beat === undefined ? {} : { beat: input.beat }),
			...(input.reroll ? { reroll: true } : {}),
			...(input.model === undefined ? {} : { model: input.model }),
		},
		pays
			? { yes: true, note: "once the user has seen the estimate" }
			: { note: "it spends nothing" },
	);

/** Whether a step calls the provider: to send a new request, or to fetch a saved one. */
const callsProvider = (step: Step): boolean => step.action !== "skip" || step.fetchesSaved;

/**
 * Fails before anything changes when the real run can't go ahead: a setting that can't be used,
 * only when it would pay for something; a missing key, only when it would send or fetch. So a run
 * that only fetches saved requests goes ahead next to a broken setting, as its dry run says.
 * Without the CLI's `--yes` it may only fetch: the post may have changed since its $0 estimate.
 */
const checkCanRun = (
	ctx: Context,
	maker: Maker,
	slug: string,
	steps: ReadonlyArray<Step>,
	mode: RunMode,
): Effect.Effect<void, ShortsError> =>
	Effect.gen(function* () {
		const pays = steps.some((step) => step.action === "generate");
		if (pays) {
			const refusal = settingsRefusal(ctx);
			if (refusal !== undefined) return yield* refusal;
		}
		if (steps.some(callsProvider)) {
			yield* Effect.forEach(maker.keys, (key) => requireKey(ctx, key), { discard: true });
		}
		if (pays && !mode.confirmed) {
			return yield* fail(
				"needs-confirmation",
				`${slug} changed since its estimate of $0 and now needs new images, which cost money; nothing was spent.`,
				"Run the same command again to see the new estimate; if it fits, run it with --yes.",
			);
		}
	});

export const imageGenerate = defineOperation({
	name: "image_generate",
	description:
		"Generate one image per beat from each beat's prompt, with the image provider in config.json (needs the approved script). Skips beats whose image is up to date and resumes interrupted requests. Spends money: try dryRun first.",
	params: {
		post: p.string("Post slug"),
		beat: p.optional(p.string("Only these beats, comma-separated (e.g. 0,3)")),
		reroll: p.boolean("Give the chosen beats a new seed and generate them again"),
		model: p.optional(
			p.string(
				"Image model: one the image provider offers or config.json adds (default: image.model in config.json, else the provider's)",
			),
		),
	},
	output: Schema.Struct({
		model: Schema.String,
		planned: Schema.Array(Planned),
		estimateUsd: Schema.Finite,
		dryRun: Schema.Boolean,
		/** On a dry run: whether the estimate fits the caps, and what's left under each. */
		budget: Schema.optionalKey(Budget),
		...NextFields,
	}),
	surface: "cli-and-mcp",
	spends: true,
	// With reroll, calling it twice pays twice, and an MCP client may retry an idempotent tool.
	hints: { readonly: false, destructive: false, idempotent: false, openWorld: true },
	run: Effect.fn("image_generate")(function* (input, ctx, mode: RunMode) {
		const maker = yield* ImageMaker;
		const model = yield* chooseModel(ctx, maker, "image", input.model);

		/** Checks the post can have images made now, then plans each chosen beat. */
		const planFor = Effect.fnUntraced(function* (post: Post) {
			yield* checkReady(ctx, post, input.post);
			// Again on this read: under the lock the plan may have changed since the first check.
			if (input.beat !== undefined) {
				yield* beatsOfPost(
					input.beat,
					input.post,
					(post.beats?.items ?? []).map((b) => b.index),
				);
			}
			const chosen = (post.beats?.items ?? []).filter(
				(b) => only === undefined || only.includes(b.index),
			);
			if (input.reroll) yield* checkRerollable(ctx, chosen, input.post);
			yield* checkFetchable(ctx, chosen, maker, input.post);
			const steps = planOf(ctx, model, post, chosen, input.reroll);
			// A dry run reports these in its budget instead.
			if (!mode.dryRun) yield* checkCanRun(ctx, maker, input.post, steps, mode);
			return steps;
		});

		// Read first outside the lock: a post that isn't there has no folder to lock.
		let post = yield* readPost(ctx, input.post);
		yield* refuseArchived(post, "image generate");
		const only =
			input.beat === undefined
				? undefined
				: yield* beatsOfPost(
						input.beat,
						input.post,
						(post.beats?.items ?? []).map((b) => b.index),
					);
		const plan = mode.dryRun
			? yield* planFor(post)
			: yield* withImagesLock(
					ctx,
					input.post,
					"image generate",
					Effect.gen(function* () {
						// Read again under the lock: a run that held it may have saved images or requests.
						const current = yield* readPost(ctx, input.post);
						const steps = yield* planFor(current);
						const done = new Set<number>();
						const markDone = (step: Step) =>
							Effect.tap(() => Effect.sync(() => done.add(step.beat.index)));
						// Every saved request first, whatever its plan, in a pass of its own: they're paid
						// for, so neither a new request nor a cap that stops one can leave them behind.
						// Only a resumed one finishes its beat: the others still need a new image, or keep theirs.
						yield* Effect.forEach(
							steps.filter((step) => step.action === "resume" || step.fetchesSaved),
							(step) =>
								fetchSaved(ctx, maker, current.slug, step).pipe(
									step.action === "resume" ? markDone(step) : Effect.asVoid,
								),
							{ concurrency: CONCURRENCY, discard: true },
						);
						yield* Effect.forEach(
							steps.filter((step) => step.action === "generate"),
							(step) => generateOne(ctx, maker, model, current.slug, step).pipe(markDone(step)),
							{ concurrency: CONCURRENCY, discard: true },
						).pipe(
							Effect.catchReason("ShortsError", "OverBudget", (reason) =>
								stoppedByCap(ctx, input.post, reason, [...done]),
							),
						);
						return steps;
					}),
				);
		const planned = plan.map(({ beat, action, fetchesSaved }) => ({
			beat: beat.index,
			action,
			// Only a new request costs: a saved one is paid for.
			estimateUsd: action === "generate" ? roundUsd(imageCost(model).usd) : 0,
			...(fetchesSaved ? { fetchesSaved: true as const } : {}),
		}));
		const total = roundUsd(planned.reduce((sum, item) => sum + item.estimateUsd, 0));

		if (!mode.dryRun) post = yield* readPost(ctx, input.post);
		const callsMaker = plan.some(callsProvider);
		const budget = mode.dryRun
			? yield* budgetFor(
					ctx,
					{ post: post.slug, usd: total },
					{ plannedUsd: mode.plannedUsd, keys: callsMaker ? maker.keys : [] },
				)
			: undefined;
		// Beats whose saved request is all they need: fetching them costs nothing, even when the
		// new requests can't go ahead.
		const fetchOnly = plan
			.filter((step) => step.beat.pending !== undefined && step.action !== "generate")
			.map((step) => step.beat.index);
		return {
			model: model.name,
			planned,
			estimateUsd: total,
			dryRun: mode.dryRun,
			...(budget === undefined ? {} : { budget }),
			// After a dry run that would make or fetch images, the next step is the real run, or the
			// user's when it can't go ahead, not another dry run.
			...(budget !== undefined && callsMaker
				? nextAfterDryRun(
						budget,
						realRunOf(post.slug, input, total > 0),
						fetchOnly.length === 0 ? undefined : freeFetchStep(post.slug, fetchOnly, input.model),
					)
				: yield* nextOf(ctx, post)),
		};
	}),
	render: (o) => {
		const counts = { generate: 0, resume: 0, skip: 0 };
		for (const item of o.planned) {
			counts[item.action]++;
			// A saved request that no longer fits is fetched too, before the beat's new request.
			if (item.fetchesSaved === true) counts.resume++;
		}
		const head = o.dryRun
			? `Would generate ${counts.generate} image${counts.generate === 1 ? "" : "s"} with ${o.model} (~${usd(o.estimateUsd)}), resume ${counts.resume}, skip ${counts.skip} up to date.`
			: `Generated ${counts.generate}, resumed ${counts.resume}, skipped ${counts.skip} (~${usd(o.estimateUsd)} with ${o.model}).`;
		const budget = o.budget === undefined ? "" : `\n${budgetLine(o.budget)}`;
		return `${head}${budget}\nNext: ${o.next}`;
	},
});
