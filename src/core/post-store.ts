/**
 * Reading and writing `post.json`.
 *
 * Writes go through `updatePost`, which takes the post's lock, re-reads the manifest, applies
 * the change and writes it back atomically with the revision bumped. Long operations (image
 * generation, rendering) don't hold the lock while they work: they record each finished piece
 * with a short `updatePost`, so the agent and the user can run commands on the same post.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Effect, Schema } from "effect";
import { MANIFEST_VERSION, Post, SCHEMA_URL } from "../domain/post.ts";
import type { Context } from "./context.ts";
import { fail, type ShortsError } from "./errors.ts";
import { acquireLock, writeFileAtomic } from "./files.ts";

const SLUG = /^[a-z0-9][a-z0-9-]{0,99}$/;

export const minePath = (ctx: Context): string => join(ctx.paths.posts, "mine");
export const postDir = (ctx: Context, slug: string): string => join(minePath(ctx), slug);
const manifestPath = (ctx: Context, slug: string): string => join(postDir(ctx, slug), "post.json");

export const checkSlug = (slug: string): Effect.Effect<string, ShortsError> =>
	SLUG.test(slug)
		? Effect.succeed(slug)
		: Effect.fail(
				fail(
					"usage",
					`"${slug}" is not a valid post slug.`,
					"Use lowercase letters, digits and dashes, e.g. 2026-11-04-morning-routine.",
				),
			);

const decodePost = Schema.decodeUnknownEffect(Schema.fromJsonString(Post), { errors: "all" });
const encodePost = Schema.encodeEffect(Schema.fromJsonString(Post));

export const readPost = (ctx: Context, slug: string): Effect.Effect<Post, ShortsError> =>
	Effect.gen(function* () {
		yield* checkSlug(slug);
		const file = manifestPath(ctx, slug);
		if (!existsSync(file)) {
			return yield* Effect.fail(
				fail("not-found", `No post "${slug}" in ${minePath(ctx)}.`, "List posts with: post list"),
			);
		}
		return yield* decodePost(readFileSync(file, "utf8")).pipe(
			Effect.mapError((error) =>
				fail(
					"failed",
					`${file} is not a valid post manifest:\n${error.message}`,
					"Fix the fields named above, or undo the hand edit. Commands write this file.",
				),
			),
		);
	});

const writePost = (ctx: Context, post: Post): Effect.Effect<void, ShortsError> =>
	encodePost({ ...post, $schema: SCHEMA_URL }).pipe(
		Effect.map((json) =>
			writeFileAtomic(
				manifestPath(ctx, post.slug),
				`${JSON.stringify(JSON.parse(json), null, 2)}\n`,
			),
		),
		Effect.mapError((error) =>
			fail(
				"failed",
				`Can't encode post.json: ${error.message}`,
				"This is a bug; please report it.",
			),
		),
	);

export const createPost = (
	ctx: Context,
	post: Omit<Post, "revision" | "manifestVersion">,
): Effect.Effect<Post, ShortsError> =>
	Effect.gen(function* () {
		yield* checkSlug(post.slug);
		const dir = postDir(ctx, post.slug);
		if (existsSync(join(dir, "post.json"))) {
			return yield* Effect.fail(
				fail(
					"conflict",
					`Post "${post.slug}" already exists.`,
					`Show it with: post show --post ${post.slug}`,
				),
			);
		}
		mkdirSync(dir, { recursive: true });
		const created: Post = { ...post, manifestVersion: MANIFEST_VERSION, revision: 1 };
		yield* writePost(ctx, created);
		return created;
	});

/**
 * Applies `change` to the latest manifest under the post's lock. `change` must be quick: it
 * runs while other commands on this post wait.
 */
export const updatePost = <E>(
	ctx: Context,
	slug: string,
	command: string,
	change: (post: Post) => Effect.Effect<Post, E>,
): Effect.Effect<Post, E | ShortsError> =>
	Effect.acquireUseRelease(
		Effect.promise(() => acquireLock(join(postDir(ctx, slug), "post.json.lock"), command)).pipe(
			Effect.flatMap((lock) =>
				"heldBy" in lock
					? Effect.fail(
							fail(
								"conflict",
								`Post "${slug}" is busy: "${lock.heldBy.command}" (pid ${lock.heldBy.pid}) has held its lock since ${lock.heldBy.since}.`,
								"Wait for that command to finish, then run this one again.",
							),
						)
					: Effect.succeed(lock),
			),
		),
		() =>
			Effect.gen(function* () {
				const current = yield* readPost(ctx, slug);
				const next = yield* change(current);
				const written: Post = { ...next, revision: current.revision + 1 };
				yield* writePost(ctx, written);
				return written;
			}),
		(lock) => Effect.sync(() => lock.release()),
	);

/** Every post folder that holds a manifest, newest first by name (names start with a date). */
export const listSlugs = (ctx: Context): ReadonlyArray<string> => {
	const dir = minePath(ctx);
	if (!existsSync(dir)) return [];
	return readdirSync(dir)
		.filter((name) => SLUG.test(name) && existsSync(join(dir, name, "post.json")))
		.sort()
		.reverse();
};
