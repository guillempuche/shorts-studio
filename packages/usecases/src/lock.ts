/**
 * Runs an Effect while holding a lock file, and releases the lock however the Effect ends. The
 * post store and the spend ledger both lock through here.
 */

import { fail, type ShortsError } from "@shorts-studio/domain/errors";
import { Effect, Schedule } from "effect";
import type { Context } from "./context.ts";
import { type LockHolder, takeLock } from "./files.ts";

/** How long a command waits for a lock that another command holds. */
export const LOCK_WAIT_MS = 10_000;

export interface LockOptions {
	readonly waitMs?: number;
	/**
	 * When a process started. Without it, a lock whose process number went to another program
	 * stays busy until the wait runs out, and the busy error says which file to delete.
	 */
	readonly processStartedAt?: Context["processStartedAt"];
}

/** A lock file's holder, once per lock taken: a later lock under the same pid is another. */
const holderKey = (holder: LockHolder): string => `${holder.pid} ${holder.since}`;

export const withLock = <A, E, R>(
	lockFile: string,
	command: string,
	busy: (holder: LockHolder | undefined, lockFile: string) => ShortsError,
	use: Effect.Effect<A, E, R>,
	{ waitMs = LOCK_WAIT_MS, processStartedAt }: LockOptions = {},
): Effect.Effect<A, E | ShortsError, R> =>
	Effect.suspend(() => {
		// Each holder's start is asked once, not on every try: a `ps` takes longer than the wait
		// between tries.
		const starts = new Map<string, Date | undefined>();
		const askStart = (holder: LockHolder | undefined): Effect.Effect<void> =>
			holder === undefined || processStartedAt === undefined || starts.has(holderKey(holder))
				? Effect.void
				: Effect.promise(async () => {
						starts.set(holderKey(holder), await processStartedAt(holder.pid));
					});
		return Effect.scoped(
			Effect.acquireRelease(
				takeLock(lockFile, command, (holder) => starts.get(holderKey(holder))),
				(lock) => Effect.sync(lock.release),
			).pipe(
				// Asked outside the try it shields, so Ctrl-C doesn't wait for `ps`. The next try uses it.
				Effect.catchTag("LockBusy", (error) =>
					Effect.andThen(askStart(error.holder), Effect.fail(error)),
				),
				// Only each single try is shielded from interruption, so Ctrl-C ends a wait at once and
				// still can't leave a lock taken but never released.
				Effect.retry({
					while: (error) => error._tag === "LockBusy",
					schedule: Schedule.spaced("100 millis").pipe(Schedule.upTo({ duration: waitMs })),
				}),
				Effect.catchTag("LockBusy", (error) => Effect.fail(busy(error.holder, lockFile))),
				Effect.andThen(use),
			),
		);
	});

/**
 * A lock still busy once the wait ran out, for `what` ("The spend ledger"). It names the holder
 * and the file: where the holder's start can't be told, a process number given to another program
 * keeps the lock until the file is deleted.
 */
export const lockBusy =
	(what: string) =>
	(holder: LockHolder | undefined, lockFile: string): ShortsError => {
		const wait = "Wait for that command to finish, then run this one again.";
		return holder === undefined
			? fail("conflict", `${what} is busy: another command is taking ${lockFile}.`, wait)
			: fail(
					"conflict",
					`${what} is busy: "${holder.command}" (pid ${holder.pid}) has held ${lockFile} since ${holder.since}.`,
					`${wait} If process ${holder.pid} isn't shorts-studio, the lock was left behind: delete ${lockFile}, then run this again.`,
				);
	};

export const busyPost = (slug: string) => lockBusy(`Post "${slug}"`);
