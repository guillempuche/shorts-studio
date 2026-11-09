/**
 * Runs an Effect while holding a lock file, and releases the lock however the Effect ends. The
 * post store and the spend ledger both lock through here.
 */

import { fail, type ShortsError } from "@shorts-studio/domain/errors";
import { Effect, Schedule } from "effect";
import { type LockHolder, takeLock } from "./files.ts";

/** How long a command waits for a lock that another command holds. */
export const LOCK_WAIT_MS = 10_000;

export const withLock = <A, E, R>(
	lockFile: string,
	command: string,
	busy: (holder: LockHolder | undefined) => ShortsError,
	use: Effect.Effect<A, E, R>,
	waitMs: number = LOCK_WAIT_MS,
): Effect.Effect<A, E | ShortsError, R> =>
	Effect.scoped(
		Effect.acquireRelease(takeLock(lockFile, command), (lock) => Effect.sync(lock.release)).pipe(
			// Only each single try is shielded from interruption, so Ctrl-C ends a wait at once and
			// still can't leave a lock taken but never released.
			Effect.retry({
				while: (error) => error._tag === "LockBusy",
				schedule: Schedule.spaced("100 millis").pipe(Schedule.upTo({ duration: waitMs })),
			}),
			Effect.catchTag("LockBusy", (error) => Effect.fail(busy(error.holder))),
			Effect.andThen(use),
		),
	);

export const busyPost = (slug: string) => (holder: LockHolder | undefined) =>
	fail(
		"conflict",
		holder === undefined
			? `Post "${slug}" is busy: another command is taking its lock.`
			: `Post "${slug}" is busy: "${holder.command}" (pid ${holder.pid}) has held its lock since ${holder.since}.`,
		"Wait for that command to finish, then run this one again.",
	);
