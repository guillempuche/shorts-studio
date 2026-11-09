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
import { Effect, Schema } from "effect";
import type { Context } from "./context.ts";
import { ensureDir, fileStep, readText, writeFileAtomic } from "./files.ts";
import { busyPost, withLock } from "./lock.ts";

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
					"Use lowercase letters, digits and dashes, e.g. 2026-11-04-morning-routine.",
				),
			);

/** A valid slug whose post exists; checked before taking its lock, which needs the folder. */
const existingPost = (ctx: Context, slug: string): Effect.Effect<string, ShortsError> =>
	checkSlug(slug).pipe(
		Effect.filterOrFail(
			() => existsSync(manifestPath(ctx, slug)),
			() =>
				fail("not-found", `No post "${slug}" in ${minePath(ctx)}.`, "List posts with: post list"),
		),
	);

const decodePost = Schema.decodeUnknownEffect(Schema.fromJsonString(Post), { errors: "all" });
const encodePost = Schema.encodeEffect(Schema.fromJsonString(Post, { space: 2 }));

export const readPost = Effect.fn("readPost")(function* (ctx: Context, slug: string) {
	const file = manifestPath(ctx, yield* existingPost(ctx, slug));
	const text = yield* readText(file, "List posts with: post list");
	return yield* decodePost(text).pipe(
		Effect.mapError((error) =>
			fail(
				"failed",
				`${file} is not a valid post file:\n${error.message}`,
				"Fix the fields named above, or undo the hand edit. Commands write this file.",
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
			),
		),
	);

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
