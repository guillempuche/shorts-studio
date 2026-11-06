/**
 * `image generate`: one image per beat, from the beat's prompt and the brand's style suffix.
 *
 * It spends money, so it needs the approved script (the morning check), `--yes` on the CLI,
 * and room under the spending caps. Each paid call is reserved in the ledger before it is sent.
 * The provider's request is saved in post.json before waiting for the image. So if a run is cut
 * short, the next run picks that request up again instead of paying twice. Beats whose image is
 * already up to date are skipped. `--reroll` gives the chosen beats a new seed.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { Effect, Schema } from "effect";
import { attempt, failWith } from "../core/attempt.ts";
import { type Context, ImageModelName } from "../core/context.ts";
import { fail } from "../core/errors.ts";
import { hashBytes, hashOf, writeFileAtomic } from "../core/files.ts";
import { parseBeatList, requireSecret } from "../core/inputs.ts";
import { release, reserve, settle } from "../core/ledger.ts";
import { defineOperation, p, type RunMode } from "../core/operation.ts";
import { postDir, readPost, updatePost } from "../core/post-store.ts";
import type { Beat, Post } from "../domain/post.ts";
import {
	collectImage,
	DEFAULT_IMAGE_MODEL,
	download,
	estimateUsd,
	FalError,
	IMAGE_MODELS,
	IMAGE_SIZE,
	type ImageModel,
	type Submitted,
	submitImage,
} from "../work/fal.ts";
import { nextStep } from "./post.ts";

const PROVIDER = "fal";
/** How many beats are generated at once. */
const CONCURRENCY = 3;

/** A fixed default seed for each beat, so running again without --reroll gives the same image. */
const defaultSeed = (slug: string, index: number): number =>
	Number.parseInt(hashOf(slug, index).slice(0, 8), 16) % 2_147_483_647;

const fullPrompt = (ctx: Context, prompt: string): string => {
	const suffix = ctx.brand.imagePrompt?.suffix?.trim();
	return suffix ? `${prompt}, ${suffix}` : prompt;
};

/** Beats without a prompt are always skipped, so the empty fallback is never sent. */
const imageInputHash = (ctx: Context, modelName: string, beat: Beat, seed: number): string =>
	hashOf(fullPrompt(ctx, beat.prompt ?? ""), modelName, seed, IMAGE_SIZE);

const isApproved = (post: Post): boolean =>
	post.script !== undefined && post.script.approvedHash === post.script.hash;

const Planned = Schema.Struct({
	beat: Schema.Int,
	action: Schema.Literals(["generate", "resume", "skip"]),
	estimateUsd: Schema.Finite,
});

/** Generates (or resumes) one beat's image and records it. */
const generateOne = Effect.fn("generateOne")(function* (
	ctx: Context,
	slug: string,
	modelName: ImageModelName,
	model: ImageModel,
	key: string,
	beat: Beat,
) {
	const seed = beat.seed ?? defaultSeed(slug, beat.index);
	const inputHash = imageInputHash(ctx, modelName, beat, seed);
	let request: Submitted & { readonly ledgerId: string };

	if (beat.pending !== undefined && beat.pending.inputHash === inputHash) {
		ctx.log(`beat ${beat.index}: resuming request ${beat.pending.requestId}`);
		request = beat.pending;
	} else {
		const usd = estimateUsd(model);
		const ledgerId = yield* reserve(ctx, {
			provider: PROVIDER,
			model: modelName,
			post: slug,
			usd,
			note: `beat ${beat.index}`,
		});
		const submitted = yield* attempt(
			(signal) => submitImage(ctx, key, model, fullPrompt(ctx, beat.prompt ?? ""), seed, signal),
			failWith("provider", "Check FAL_KEY and your connection, then run it again."),
		).pipe(Effect.tapError(() => Effect.ignore(release(ctx, ledgerId))));
		request = { ...submitted, ledgerId };
		yield* updatePost(ctx, slug, "image generate", (post) =>
			Effect.succeed(
				withBeat(post, beat.index, (b) => ({
					...b,
					pending: { provider: PROVIDER, model: modelName, inputHash, seed, ...request },
				})),
			),
		);
		ctx.log(`beat ${beat.index}: submitted (${submitted.requestId})`);
	}

	let terminal = false;
	const bytes = yield* attempt(
		async (signal) => download(ctx, await collectImage(ctx, key, request, signal), signal),
		(error) => {
			terminal = error instanceof FalError && error.terminal;
			return fail(
				"provider",
				error instanceof Error ? error.message : String(error),
				terminal
					? `Run image generate --post ${slug} --yes to send a new request.`
					: // Not "run the same command": with --reroll, that would pick a new seed and pay again.
						`Run image generate --post ${slug} --yes (without --reroll): it resumes this request.`,
			);
		},
	).pipe(
		// FAL ended this request without an image, so it will never finish: forget it and free the reservation.
		Effect.tapError(() =>
			terminal
				? release(ctx, request.ledgerId).pipe(
						Effect.andThen(
							updatePost(ctx, slug, "image generate", (post) =>
								Effect.succeed(withBeat(post, beat.index, dropPending)),
							),
						),
						Effect.ignore,
					)
				: Effect.void,
		),
	);

	const dir = join(postDir(ctx, slug), "images");
	mkdirSync(dir, { recursive: true });
	const file = join("images", `beat-${String(beat.index).padStart(2, "0")}.jpg`);
	writeFileAtomic(join(postDir(ctx, slug), file), bytes);
	yield* updatePost(ctx, slug, "image generate", (post) =>
		Effect.succeed(
			withBeat(post, beat.index, (b) => ({
				...dropPending(b),
				seed,
				image: {
					file,
					hash: hashBytes(bytes),
					inputHash,
					provider: PROVIDER,
					model: modelName,
					seed,
					source: "generated" as const,
				},
			})),
		),
	);
	yield* settle(ctx, request.ledgerId, estimateUsd(model), request.requestId);
	ctx.log(`beat ${beat.index}: saved ${file}`);
});

const dropPending = (beat: Beat): Beat => {
	const { pending: _, ...rest } = beat;
	return rest;
};

const withBeat = (post: Post, index: number, change: (beat: Beat) => Beat): Post =>
	post.beats === undefined
		? post
		: {
				...post,
				beats: {
					...post.beats,
					items: post.beats.items.map((b) => (b.index === index ? change(b) : b)),
				},
			};

export const imageGenerate = defineOperation({
	name: "image_generate",
	description:
		"Generate one image per beat on FAL from each beat's prompt (needs the approved script). Skips beats whose image is up to date and resumes interrupted requests. Spends money: try dryRun first.",
	params: {
		post: p.string("Post slug"),
		beat: p.optional(p.string("Only these beats, comma-separated (e.g. 0,3)")),
		reroll: p.boolean("Give the chosen beats a new seed and generate them again"),
		model: p.optional(p.literals(ImageModelName.literals, "Image model")),
	},
	output: Schema.Struct({
		model: Schema.String,
		planned: Schema.Array(Planned),
		estimateUsd: Schema.Finite,
		dryRun: Schema.Boolean,
		next: Schema.String,
	}),
	surface: "cli-and-mcp",
	spends: true,
	hints: { readonly: false, destructive: false, idempotent: true, openWorld: true },
	run: (input, ctx, mode: RunMode) =>
		Effect.gen(function* () {
			const only = input.beat === undefined ? undefined : yield* parseBeatList(input.beat);
			const modelName = input.model ?? ctx.config.image?.model ?? DEFAULT_IMAGE_MODEL;
			const model = IMAGE_MODELS[modelName];
			let post = yield* readPost(ctx, input.post);
			if (!isApproved(post)) {
				return yield* fail(
					"needs-confirmation",
					`${input.post}'s script isn't approved, so nothing will be spent on images yet.`,
					`The user approves it after reading it: script approve --post ${input.post}`,
				);
			}
			const beats = post.beats?.items ?? [];
			const missing = beats
				.filter((b) => b.prompt === undefined && b.image?.source !== "imported")
				.map((b) => b.index);
			if (beats.length === 0 || missing.length > 0) {
				return yield* fail(
					"not-found",
					beats.length === 0
						? `${input.post} has no beats.`
						: `Beats without a prompt: ${missing.join(", ")}.`,
					nextStep(post),
				);
			}

			if (input.reroll && !mode.dryRun) {
				const targets = new Set(only ?? beats.map((b) => b.index));
				const reseed = (b: Beat, slug: string): Beat =>
					targets.has(b.index)
						? {
								...dropPending(b),
								seed: ((b.seed ?? defaultSeed(slug, b.index)) + 1) % 2_147_483_647,
							}
						: b;
				post = yield* updatePost(ctx, input.post, "image generate", (current) =>
					Effect.succeed(
						current.beats === undefined
							? current
							: {
									...current,
									beats: {
										...current.beats,
										items: current.beats.items.map((b) => reseed(b, current.slug)),
									},
								},
					),
				);
			}

			const chosen = (post.beats?.items ?? []).filter(
				(b) => only === undefined || only.includes(b.index),
			);
			const planned = chosen.map((b) => {
				const seed = b.seed ?? defaultSeed(post.slug, b.index);
				const hash = imageInputHash(
					ctx,
					modelName,
					b,
					input.reroll && mode.dryRun ? seed + 1 : seed,
				);
				// An imported image (Midjourney, a photo) stays unless the beat is rerolled. A beat
				// without a prompt (allowed only with an imported image) is never sent, rerolled or not.
				const imported = b.image?.source === "imported" && !input.reroll;
				const action =
					b.prompt === undefined
						? "skip"
						: b.pending?.inputHash === hash
							? "resume"
							: imported || b.image?.inputHash === hash
								? "skip"
								: "generate";
				return {
					beat: b.index,
					action,
					estimateUsd: action === "generate" ? estimateUsd(model) : 0,
				} as const;
			});
			const total = planned.reduce((sum, item) => sum + item.estimateUsd, 0);

			if (!mode.dryRun) {
				const key = yield* requireSecret(ctx, "FAL_KEY");
				const work = chosen.filter(
					(b) => planned.find((item) => item.beat === b.index)?.action !== "skip",
				);
				yield* Effect.forEach(
					work,
					(beat) => generateOne(ctx, post.slug, modelName, model, key, beat),
					{ concurrency: CONCURRENCY, discard: true },
				);
				post = yield* readPost(ctx, input.post);
			}
			return {
				model: modelName,
				planned,
				estimateUsd: total,
				dryRun: mode.dryRun,
				next: nextStep(post),
			};
		}),
	render: (o) => {
		const counts = { generate: 0, resume: 0, skip: 0 };
		for (const item of o.planned) counts[item.action]++;
		const head = o.dryRun
			? `Would generate ${counts.generate} image${counts.generate === 1 ? "" : "s"} with ${o.model} (~$${o.estimateUsd.toFixed(3)}), resume ${counts.resume}, skip ${counts.skip} up to date.`
			: `Generated ${counts.generate}, resumed ${counts.resume}, skipped ${counts.skip} (~$${o.estimateUsd.toFixed(3)} with ${o.model}).`;
		return `${head}\nNext: ${o.next}`;
	},
});
