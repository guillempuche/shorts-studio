/**
 * Reading what a command needs from outside its input: API keys, and beat lists typed as text.
 * Shared so each failure reads the same in every command.
 */

import { Effect } from "effect";
import type { Context, SecretName } from "./context.ts";
import { fail, type ShortsError } from "./errors.ts";

/** An API key, or a `missing-key` failure that says where to set it. */
export const requireSecret = (ctx: Context, name: SecretName): Effect.Effect<string, ShortsError> =>
	Effect.promise(() => ctx.secret(name)).pipe(
		Effect.flatMap((key) =>
			key === undefined
				? Effect.fail(
						fail(
							"missing-key",
							`${name} isn't set.`,
							"Set it in your environment or the Keychain: config show explains how.",
						),
					)
				: Effect.succeed(key),
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
