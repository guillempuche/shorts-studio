/** Running a command against a lock that stays busy, without waiting out its 10 s. */

import { Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { LOCK_WAIT_MS } from "../lock.ts";

/**
 * The error `effect` gives up with while another command holds its lock: the test clock jumps
 * past the wait instead of the test waiting for it.
 */
export const failurePastLockWait = <A, E>(effect: Effect.Effect<A, E>): Promise<E> =>
	Effect.runPromise(
		Effect.gen(function* () {
			const waiting = yield* Effect.forkChild(Effect.flip(effect));
			// Real time, so the first try and the question about the holder's start (a promise)
			// settle before the clock jumps; every later try is quick.
			yield* Effect.promise(() => new Promise((settled) => setTimeout(settled, 50)));
			yield* TestClock.adjust(LOCK_WAIT_MS + 1_000);
			return yield* Fiber.join(waiting);
		}).pipe(Effect.provide(TestClock.layer())),
	);
