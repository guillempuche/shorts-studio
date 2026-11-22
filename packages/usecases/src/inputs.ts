/**
 * Reading API keys, and beat lists and language codes typed as text, and checking the user is
 * there. Shared, so each failure reads the same in every command.
 */

import { statSync } from "node:fs";
import { resolve } from "node:path";
import { fail, type ShortsError } from "@shorts-studio/domain/errors";
import { Effect, type Redacted } from "effect";
import type { Context, KeySpec } from "./context.ts";
import { userStep } from "./steps.ts";

/** An API key, or a `missing-key` failure that says where to set it. */
export const requireKey = (
	ctx: Context,
	key: KeySpec,
): Effect.Effect<Redacted.Redacted<string>, ShortsError> =>
	Effect.promise(() => ctx.secret(key)).pipe(
		Effect.flatMap((value) =>
			value === undefined
				? Effect.fail(
						fail(
							"missing-key",
							`${key.env} isn't set.`,
							`Ask the user to set ${key.env}: in their environment, or on macOS in the Keychain with security add-generic-password -U -a "$USER" -s ${key.keychain} -w. A running MCP server reads a Keychain key on its next call, but needs a restart for one set in the environment.`,
							[userStep(undefined, `the user sets ${key.env}; only the user handles API keys`)],
						),
					)
				: Effect.succeed(value),
		),
	);

/**
 * The full path of a file to read, or a failure that names that full path: `not-found` when
 * nothing is there, `usage` when it's a folder or something else. A relative path is read from
 * the folder shorts-studio runs in, which for MCP is where the server started.
 */
export const inputFile = (path: string, fix: string): Effect.Effect<string, ShortsError> =>
	Effect.suspend(() => {
		const full = resolve(path);
		const stat = statSync(full, { throwIfNoEntry: false });
		if (stat === undefined) return Effect.fail(fail("not-found", `No file at ${full}.`, fix));
		if (!stat.isFile()) {
			return Effect.fail(
				fail("usage", `${full} is ${stat.isDirectory() ? "a folder" : "not a file"}.`, fix),
			);
		}
		return Effect.succeed(full);
	});

/** What a path parameter's description adds, so the caller knows where a relative one points. */
export const RELATIVE_PATH = "a relative path is read from the folder shorts-studio runs in";

/**
 * Fails unless a person is at the terminal. Approving a script or a draft is the user's
 * decision. An agent's shell has no terminal, however it writes the command, and one that opens
 * a pseudo-terminal still carries its agent's marker.
 */
export const requireUser = (ctx: Context, command: string): Effect.Effect<void, ShortsError> => {
	const theirs = [userStep(command, "the user's decision, in their own terminal")];
	if (ctx.agentShell !== undefined) {
		return Effect.fail(
			fail(
				"needs-approval",
				`${command} records the user's decision, and this runs in an agent's shell (${ctx.agentShell} is set).`,
				`Ask the user to run it in their own terminal, outside the agent: ${command}`,
				theirs,
			),
		);
	}
	return ctx.interactive
		? Effect.void
		: Effect.fail(
				fail(
					"needs-approval",
					`${command} records the user's decision, and no one is at a terminal.`,
					`Ask the user to run it in their own terminal: ${command}`,
					theirs,
				),
			);
};

/**
 * A language code to force on transcription, or undefined to detect it. Checked before the
 * audio goes to a paid provider, which would bill a request it can't use.
 */
export const checkLanguage = (
	language: string | undefined,
): Effect.Effect<string | undefined, ShortsError> =>
	language === undefined || /^[a-z]{2}$/.test(language)
		? Effect.succeed(language)
		: Effect.fail(
				fail(
					"usage",
					`"${language}" isn't a two-letter language code.`,
					"Use es, en, ca, fr…, or leave it out to detect the language.",
				),
			);

/** The parts of a beat list, `"0, 3"` → `["0", "3"]`, and those that aren't whole numbers from 0. */
const beatParts = (value: string) => {
	const parts = value.split(",").map((part) => part.trim());
	return { parts, bad: parts.filter((part) => !/^\d+$/.test(part)) };
};

const quoted = (parts: ReadonlyArray<string>) => parts.map((part) => `"${part}"`).join(", ");

/** `"0, 3,4"` → `[0, 3, 4]`; undefined → empty. Only whole numbers from 0: not `0x`, `1.5` or `-1`. */
export const parseBeatList = (
	value: string | undefined,
): Effect.Effect<ReadonlyArray<number>, ShortsError> => {
	if (value === undefined) return Effect.succeed([]);
	const { parts, bad } = beatParts(value);
	return bad.length === 0
		? Effect.succeed(parts.map(Number))
		: Effect.fail(
				fail(
					"usage",
					`${quoted(bad)} ${bad.length === 1 ? "isn't a beat number" : "aren't beat numbers"}.`,
					"Use beat indexes separated by commas, e.g. 0,3.",
				),
			);
};

/**
 * The beats of `slug` a list names, or a `usage` failure naming each value that isn't one of
 * `indexes` and the beats the post has. Checked before anything is reserved or sent: a beat
 * the plan doesn't have would otherwise be skipped, and the run would do nothing.
 */
export const beatsOfPost = (
	value: string,
	slug: string,
	indexes: ReadonlyArray<number>,
): Effect.Effect<ReadonlyArray<number>, ShortsError> => {
	// A post with no beats yet fails later, with the step that plans them.
	if (indexes.length === 0) return parseBeatList(value);
	const { parts } = beatParts(value);
	const bad = parts.filter((part) => !/^\d+$/.test(part) || !indexes.includes(Number(part)));
	if (bad.length === 0) return Effect.succeed(parts.map(Number));
	return Effect.fail(
		fail(
			"usage",
			`${quoted(bad)} ${bad.length === 1 ? "isn't a beat" : "aren't beats"} of ${slug}, which has beats ${Math.min(...indexes)}–${Math.max(...indexes)}.`,
			"Pass beat numbers the post has, separated by commas, e.g. 0,3.",
		),
	);
};
