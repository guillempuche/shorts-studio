/**
 * Reading and writing `post.json`.
 *
 * Writes go through `updatePost`. It takes the post's lock, reads post.json again, applies the
 * change, adds one to the revision and writes the whole file back in one step. Long operations
 * (image generation, rendering) don't hold the lock while they work. They save each finished
 * piece with a short `updatePost`, so the agent and the user can work on the same post at once.
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fail, type ShortsError } from "@shorts-studio/domain/errors";
import { MANIFEST_VERSION, Post, SCHEMA_URL, Slug } from "@shorts-studio/domain/post";
import { Effect, Result, Schema } from "effect";
import type { Context } from "./context.ts";
import { ensureDir, fileStep, readText, writeFileAtomic } from "./files.ts";
import { busyPost, withLock } from "./lock.ts";
import { agentStep, userStep } from "./steps.ts";

const isSlug = Schema.is(Slug);

export const minePath = (ctx: Context): string => join(ctx.paths.posts, "mine");
export const postDir = (ctx: Context, slug: string): string => join(minePath(ctx), slug);
const manifestPath = (ctx: Context, slug: string): string => join(postDir(ctx, slug), "post.json");

export const checkSlug = (slug: string): Effect.Effect<string, ShortsError> =>
	isSlug(slug)
		? Effect.succeed(slug)
		: Effect.fail(
				fail(
					"usage",
					`"${slug}" is not a valid post slug.`,
					"Use lowercase letters, digits and dashes, e.g. morning-routine.",
				),
			);

/** A slug that starts with its post's date, as `post create` makes them: 2026-11-04-morning. */
export const DATED = /^\d{4}-\d{2}-\d{2}-/;

/** A valid slug whose post exists; checked before taking its lock, which needs the folder. */
const existingPost = (ctx: Context, slug: string): Effect.Effect<string, ShortsError> =>
	checkSlug(slug).pipe(
		Effect.flatMap((checked) =>
			existsSync(manifestPath(ctx, slug)) ? Effect.succeed(checked) : notFound(ctx, slug),
		),
	);

/**
 * A post that isn't there. `post create` puts the date in front of a slug, so the fix names each
 * post that is the given slug with a date in front, newest first, with a `post_show` step each.
 */
const notFound = (ctx: Context, slug: string): Effect.Effect<never, ShortsError> =>
	listSlugs(ctx).pipe(
		// A folder that can't be listed only loses the suggestion; the post is still not found.
		Effect.catch(() => Effect.succeed<ReadonlyArray<string>>([])),
		Effect.flatMap((slugs) => {
			// listSlugs gives them newest first.
			const dated = slugs.filter((name) => DATED.test(name) && name.replace(DATED, "") === slug);
			const message = `No post "${slug}" in ${minePath(ctx)}.`;
			if (dated.length === 0) {
				return Effect.fail(
					fail("not-found", message, "List posts with: post list", [agentStep("post_list", {})]),
				);
			}
			const fix =
				dated.length === 1
					? `Did you mean ${dated[0]}? Show it with: post show --post ${dated[0]}`
					: `Did you mean one of ${dated.join(", ")}? Show one with: post show --post <slug>`;
			return Effect.fail(
				fail(
					"not-found",
					message,
					fix,
					dated.map((meant, i) => agentStep("post_show", { post: meant }, { or: i > 0 })),
				),
			);
		}),
	);

const decodePost = Schema.decodeUnknownEffect(Post, { errors: "all" });
const encodePost = Schema.encodeEffect(Schema.fromJsonString(Post, { space: 2 }));

/**
 * A post.json that can't be read: commands write it, so a hand edit broke it. Mending it, or
 * moving the post out of the way, is the user's: the agent doesn't edit post.json.
 */
const unreadable = (ctx: Context, message: string, mend: string) => {
	const fix = `Ask the user to ${mend}, or to move the post's folder out of ${minePath(ctx)}. Commands write this file; a hand edit broke it.`;
	return fail("failed", message, fix, [
		userStep(undefined, `the user's: ${mend}, or move the post's folder out of ${minePath(ctx)}`),
	]);
};

export const readPost = Effect.fn("readPost")(function* (ctx: Context, slug: string) {
	const file = manifestPath(ctx, yield* existingPost(ctx, slug));
	const text = yield* readText(file, "List posts with: post list");
	const json = yield* Effect.try({
		try: (): unknown => JSON.parse(text),
		catch: (error) =>
			unreadable(
				ctx,
				`${file} isn't JSON: ${error instanceof Error ? error.message : String(error)}`,
				"restore it from a backup or version control",
			),
	});
	return yield* decodePost(json).pipe(
		Effect.mapError((error) =>
			unreadable(
				ctx,
				`${file} is not a valid post file:\n${error.message}`,
				"fix the fields named in the message, or undo the hand edit",
			),
		),
	);
});

const writePost = (ctx: Context, slug: string, post: Post): Effect.Effect<void, ShortsError> =>
	encodePost({ ...post, $schema: SCHEMA_URL }).pipe(
		Effect.mapError((error) =>
			fail(
				"failed",
				`Can't turn the post into JSON: ${error.message}`,
				"This is a bug: please report it.",
			),
		),
		Effect.flatMap((json) => writeFileAtomic(manifestPath(ctx, slug), `${json}\n`)),
	);

export const createPost = Effect.fn("createPost")(function* (
	ctx: Context,
	post: Omit<Post, "revision" | "manifestVersion">,
) {
	yield* checkSlug(post.slug);
	const dir = postDir(ctx, post.slug);
	if (existsSync(join(dir, "post.json"))) {
		return yield* fail(
			"conflict",
			`Post "${post.slug}" already exists.`,
			`Show it with: post show --post ${post.slug}`,
		);
	}
	yield* ensureDir(dir);
	const created: Post = { ...post, manifestVersion: MANIFEST_VERSION, revision: 1 };
	yield* writePost(ctx, post.slug, created);
	return created;
});

/**
 * Applies `change` to the latest post.json while holding the post's lock. Keep `change` quick:
 * other commands on this post wait while it runs.
 */
export const updatePost = <E>(
	ctx: Context,
	slug: string,
	command: string,
	change: (post: Post) => Effect.Effect<Post, E>,
): Effect.Effect<Post, E | ShortsError> =>
	existingPost(ctx, slug).pipe(
		Effect.andThen(
			withLock(
				join(postDir(ctx, slug), "post.json.lock"),
				command,
				busyPost(slug),
				Effect.gen(function* () {
					const current = yield* readPost(ctx, slug);
					// Writes go to the folder the post was read from, and only while the file names that
					// folder: a copied folder must not change the original's post.
					if (current.slug !== slug) {
						const file = manifestPath(ctx, slug);
						return yield* fail(
							"failed",
							`${file} names the post "${current.slug}", but its folder is "${slug}".`,
							`Set "slug" to "${slug}" in ${file}, or rename the folder back.`,
						);
					}
					const next = yield* change(current);
					const written: Post = { ...next, revision: current.revision + 1 };
					yield* writePost(ctx, slug, written);
					return written;
				}),
				{ processStartedAt: ctx.processStartedAt },
			),
		),
	);

/**
 * Fails when `post` is archived: an archived post no longer changes or spends. Commands call it
 * right after their first read, before they reserve or write anything. `updatePost` itself doesn't,
 * so a command already running when the post was archived still saves what it paid for.
 */
export const refuseArchived = (post: Post, command: string): Effect.Effect<void, ShortsError> =>
	post.archivedAt === undefined
		? Effect.void
		: Effect.fail(
				fail(
					"conflict",
					`${post.slug} is archived; it no longer changes, so ${command} didn't run.`,
					"An archived post can't be taken out of the archive. For new work, create a post: post create --post <slug>",
				),
			);

/**
 * Every post, newest first, each named by its folder. The ones that can't be read are listed
 * apart, with their error: one damaged post.json mustn't hide the others.
 */
export const readPosts = Effect.fn("readPosts")(function* (ctx: Context) {
	const outcomes = yield* Effect.forEach(yield* listSlugs(ctx), (slug) =>
		Effect.map(Effect.result(readPost(ctx, slug)), (outcome) => ({ slug, outcome })),
	);
	return {
		posts: outcomes.flatMap(({ slug, outcome }) =>
			Result.isSuccess(outcome) ? [{ slug, post: outcome.success }] : [],
		),
		unreadable: outcomes.flatMap(({ slug, outcome }) =>
			Result.isFailure(outcome) ? [{ slug, error: outcome.failure }] : [],
		),
	};
});

/** Every post folder that holds a post.json, newest first (folder names start with a date). */
export const listSlugs = (ctx: Context): Effect.Effect<ReadonlyArray<string>, ShortsError> => {
	const dir = minePath(ctx);
	return fileStep(
		() =>
			existsSync(dir)
				? readdirSync(dir)
						.filter((name) => isSlug(name) && existsSync(join(dir, name, "post.json")))
						.sort()
						.reverse()
				: [],
		`Check that ${dir} is a folder you can read.`,
	);
};
