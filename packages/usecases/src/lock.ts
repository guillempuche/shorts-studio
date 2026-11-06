/**
 * Runs an Effect while holding a lock file, and releases the lock however the Effect ends. The
 * post store and the spend ledger both lock through here.
 */

import { fail, type ShortsError } from "@shorts-studio/domain/errors";
import { Effect } from "effect";
import { failWith } from "./attempt.ts";
import { acquireLock, type LockHolder } from "./files.ts";

export const withLock = <A, E>(
	lockFile: string,
	command: string,
	busy: (holder: LockHolder) => ShortsError,
	use: Effect.Effect<A, E>,
): Effect.Effect<A, E | ShortsError> =>
	Effect.acquireUseRelease(
		Effect.tryPromise({
			try: () => acquireLock(lockFile, command),
			catch: failWith(
				"failed",
				`Couldn't create ${lockFile}; check the folder exists and is writable.`,
			),
		}).pipe(
			Effect.flatMap((lock) =>
				"heldBy" in lock ? Effect.fail(busy(lock.heldBy)) : Effect.succeed(lock),
			),
		),
		() => use,
		(lock) => Effect.sync(() => lock.release()),
	);

export const busyPost = (slug: string) => (holder: LockHolder) =>
	fail(
		"conflict",
		`Post "${slug}" is busy: "${holder.command}" (pid ${holder.pid}) has held its lock since ${holder.since}.`,
		"Wait for that command to finish, then run this one again.",
	);
