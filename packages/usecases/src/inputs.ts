/**
 * Reading API keys, and beat lists and language codes typed as text. Shared, so each failure
 * reads the same in every command.
 */

import { fail, type ShortsError } from "@shorts-studio/domain/errors";
import { Effect, type Redacted } from "effect";
import type { Context, KeySpec } from "./context.ts";

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
							`Set it in your environment, or on macOS in the Keychain: security add-generic-password -U -a "$USER" -s ${key.keychain} -w`,
						),
					)
				: Effect.succeed(value),
		),
	);

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

/** `"0, 3,4"` → `[0, 3, 4]`; undefined → empty. */
export const parseBeatList = (
	value: string | undefined,
): Effect.Effect<ReadonlyArray<number>, ShortsError> => {
	if (value === undefined) return Effect.succeed([]);
	const list = value.split(",").map((part) => Number.parseInt(part.trim(), 10));
	return list.every(Number.isInteger)
		? Effect.succeed(list)
		: Effect.fail(
				fail(
					"usage",
					`"${value}" isn't a beat list.`,
					"Use beat indexes separated by commas, e.g. 0,3.",
				),
			);
};
