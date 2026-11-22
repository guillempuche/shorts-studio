/**
 * The script: the story the user checks in the morning, before anything is spent on images.
 *
 * The agent writes it with `script set`. The user approves it with `script approve`, which is
 * CLI-only and needs a terminal because it's the user's decision. Approval covers the script, the
 * audio and every image prompt, so a change to any of them needs approving again.
 */

import { join } from "node:path";
import { HOOK_LAYOUT } from "@shorts-studio/domain/direction";
import { fail, type ShortsError } from "@shorts-studio/domain/errors";
import { approvalOf, isScriptApproved } from "@shorts-studio/domain/post";
import { Effect, Schema } from "effect";
import { hashOf, readText, writeFileAtomic } from "../files.ts";
import { inputFile, RELATIVE_PATH, requireUser } from "../inputs.ts";
import { defineOperation, p } from "../operation.ts";
import { postDir, readPost, refuseArchived, updatePost } from "../post-store.ts";
import { agentStep } from "../steps.ts";
import { NextFields, nextOf } from "./post.ts";

const SCRIPT_FILE = "script.md";

const BOTH_FORMS =
	"Pass the script inline with --text <script>, or as a Markdown file with --file <script.md>.";

/** The script's text, from exactly one of `text` and `file`; never empty. */
const scriptText = (input: {
	readonly text: string | undefined;
	readonly file: string | undefined;
}): Effect.Effect<string, ShortsError> =>
	Effect.gen(function* () {
		if (input.text !== undefined && input.file !== undefined) {
			return yield* fail(
				"usage",
				"--text and --file each give the script; pass only one.",
				BOTH_FORMS,
			);
		}
		const text =
			input.text ??
			(input.file === undefined
				? yield* fail("usage", "No script given.", BOTH_FORMS)
				: yield* readText(
						yield* inputFile(
							input.file,
							"Write the script to a file first, or pass it inline with --text.",
						),
						"Write the script to a file first, or pass it inline with --text.",
					));
		if (text.trim() === "") {
			return yield* fail(
				"usage",
				"The script is empty.",
				"Write the story the user approves: the hook, the beats and the call to action.",
			);
		}
		return text;
	});

/** The hook to save: undefined to keep the one there, "" to remove it, else 3 to 7 words. */
const checkHook = (hook: string | undefined): Effect.Effect<string | undefined, ShortsError> => {
	if (hook === undefined || hook.trim() === "") return Effect.succeed(hook?.trim());
	const words = hook.trim().split(/\s+/).length;
	const { minWords, maxWords } = HOOK_LAYOUT;
	return words >= minWords && words <= maxWords
		? Effect.succeed(hook.trim())
		: Effect.fail(
				fail(
					"usage",
					`The hook has ${words} word${words === 1 ? "" : "s"}.`,
					`Use ${minWords} to ${maxWords} words, so it reads in its first seconds; --hook "" removes it.`,
				),
			);
};

export const scriptSet = defineOperation({
	name: "script_set",
	description:
		"Save the post's script (story, hook, beats, CTA), passed inline as text or read from a Markdown file. Use one of the two. Replacing an approved script clears the approval; a new hook alone doesn't, since the draft review shows it.",
	params: {
		post: p.string("Post slug"),
		text: p.optional(p.string("The script, in Markdown")),
		file: p.optional(p.string(`Markdown file to save as the post's script.md; ${RELATIVE_PATH}`)),
		hook: p.optional(
			p.string(
				`On-screen title for the draft's first seconds (${HOOK_LAYOUT.minWords}–${HOOK_LAYOUT.maxWords} words); "" removes it`,
			),
		),
	},
	output: Schema.Struct({ file: Schema.String, approved: Schema.Boolean, ...NextFields }),
	surface: "cli-and-mcp",
	spends: false,
	hints: { readonly: false, destructive: false, idempotent: true, openWorld: false },
	run: Effect.fn("script_set")(function* (input, ctx) {
		const text = yield* scriptText(input);
		const hook = yield* checkHook(input.hook);
		const hash = hashOf(text);
		yield* refuseArchived(yield* readPost(ctx, input.post), "script set");
		yield* writeFileAtomic(join(postDir(ctx, input.post), SCRIPT_FILE), text);
		const post = yield* updatePost(ctx, input.post, "script set", (post) => {
			// The approval stays, and holds only if the text is unchanged; so does the hook, unless given.
			const { hook: kept, ...script } = { ...post.script, file: SCRIPT_FILE, hash };
			const nextHook = hook === undefined ? kept : hook === "" ? undefined : hook;
			return Effect.succeed({
				...post,
				script: { ...script, ...(nextHook === undefined ? {} : { hook: nextHook }) },
			});
		});
		return {
			file: join(postDir(ctx, input.post), SCRIPT_FILE),
			approved: isScriptApproved(post),
			...(yield* nextOf(ctx, post)),
		};
	}),
	render: (o) =>
		`Saved ${o.file}${o.approved ? " (unchanged, still approved)" : ""}\nNext: ${o.next}`,
});

export const scriptApprove = defineOperation({
	name: "script_approve",
	description:
		"Approve the post's current script, audio and image prompts: the user's morning check, run in their own terminal. Image generation needs it.",
	params: { post: p.string("Post slug") },
	output: Schema.Struct({ approvedAt: Schema.String, ...NextFields }),
	surface: "cli-only",
	spends: false,
	hints: { readonly: false, destructive: false, idempotent: true, openWorld: false },
	run: Effect.fn("script_approve")(function* (input, ctx) {
		yield* requireUser(ctx, `script approve --post ${input.post}`);
		const approvedAt = ctx.now().toISOString();
		const post = yield* updatePost(ctx, input.post, "script approve", (post) =>
			post.archivedAt !== undefined
				? refuseArchived(post, "script approve").pipe(Effect.as(post))
				: post.script === undefined
					? Effect.fail(
							fail(
								"not-found",
								`${input.post} has no script yet.`,
								`Save one first: script set --post ${input.post} --text <script>`,
								[agentStep("script_set", { post: input.post, text: "<script>" })],
							),
						)
					: Effect.succeed({
							...post,
							script: { ...post.script, ...approvalOf(post), approvedAt },
						}),
		);
		return { approvedAt, ...(yield* nextOf(ctx, post)) };
	}),
	render: (o) => `Script approved.\nNext: ${o.next}`,
});
