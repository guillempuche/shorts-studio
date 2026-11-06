/**
 * The script: the story the user checks in the morning, before anything is spent on images.
 *
 * The agent writes it with `script set`. The user approves it with `script approve`, which is
 * CLI-only because it's the user's decision. Approval is tied to the script's hash, so an edited
 * script needs approving again.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fail } from "@shorts-studio/domain/errors";
import { Effect, Schema } from "effect";
import { hashOf, writeFileAtomic } from "../files.ts";
import { defineOperation, p } from "../operation.ts";
import { postDir, readPost, updatePost } from "../post-store.ts";
import { nextStep } from "./post.ts";

const SCRIPT_FILE = "script.md";

export const scriptSet = defineOperation({
	name: "script_set",
	description:
		"Save the post's script from a Markdown file (story, hook, beats, CTA). Replacing an approved script clears the approval.",
	params: {
		post: p.string("Post slug"),
		file: p.string("Path to the Markdown script to save as the post's script.md"),
		hook: p.optional(p.string("On-screen title for the draft's first seconds (3–7 words)")),
	},
	output: Schema.Struct({ file: Schema.String, approved: Schema.Boolean, next: Schema.String }),
	surface: "cli-and-mcp",
	spends: false,
	hints: { readonly: false, destructive: false, idempotent: true, openWorld: false },
	run: (input, ctx) =>
		Effect.gen(function* () {
			if (!existsSync(input.file)) {
				return yield* fail(
					"not-found",
					`No file at ${input.file}.`,
					"Write the script to a file first, then pass its path.",
				);
			}
			const text = readFileSync(input.file, "utf8");
			const hash = hashOf(text);
			yield* readPost(ctx, input.post);
			writeFileAtomic(join(postDir(ctx, input.post), SCRIPT_FILE), text);
			const post = yield* updatePost(ctx, input.post, "script set", (post) =>
				Effect.succeed({
					...post,
					script: {
						file: SCRIPT_FILE,
						hash,
						...(input.hook !== undefined
							? { hook: input.hook }
							: post.script?.hook !== undefined
								? { hook: post.script.hook }
								: {}),
						...(post.script?.approvedHash !== undefined
							? { approvedHash: post.script.approvedHash }
							: {}),
						...(post.script?.approvedAt !== undefined
							? { approvedAt: post.script.approvedAt }
							: {}),
					},
				}),
			);
			return {
				file: join(postDir(ctx, input.post), SCRIPT_FILE),
				approved: post.script?.approvedHash === hash,
				next: nextStep(post),
			};
		}),
	render: (o) =>
		`Saved ${o.file}${o.approved ? " (unchanged, still approved)" : ""}\nNext: ${o.next}`,
});

export const scriptApprove = defineOperation({
	name: "script_approve",
	description:
		"Approve the post's current script: the user's morning check. Image generation needs it.",
	params: { post: p.string("Post slug") },
	output: Schema.Struct({ approvedAt: Schema.String, next: Schema.String }),
	surface: "cli-only",
	spends: false,
	hints: { readonly: false, destructive: false, idempotent: true, openWorld: false },
	run: (input, ctx) =>
		Effect.gen(function* () {
			const approvedAt = ctx.now().toISOString();
			const post = yield* updatePost(ctx, input.post, "script approve", (post) =>
				post.script === undefined
					? Effect.fail(
							fail(
								"not-found",
								`${input.post} has no script yet.`,
								`Save one first: script set --post ${input.post} --file script.md`,
							),
						)
					: Effect.succeed({
							...post,
							script: { ...post.script, approvedHash: post.script.hash, approvedAt },
						}),
			);
			return { approvedAt, next: nextStep(post) };
		}),
	render: (o) => `Script approved.\nNext: ${o.next}`,
});
