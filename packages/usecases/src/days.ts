/**
 * Days and months in the machine's time zone, not UTC: a call made at 00:30 counts toward the
 * new day's cap, and a post made then is dated that day.
 */

import { DateTime } from "effect";
import type { Context } from "./context.ts";

/**
 * The local calendar around one instant. A command reads the clock once and takes everything
 * from it, so a day and its total can't come from either side of midnight.
 */
export interface LocalDays {
	/** The instant itself, as the ledger and post.json write it. */
	readonly at: string;
	/** YYYY-MM-DD. */
	readonly today: string;
	/** YYYY-MM. */
	readonly month: string;
	/**
	 * Where today and this month start, written like `at`. Those strings sort in time order, so a
	 * ledger line is from today when its `at` is at least `startOfToday`: no date maths per line.
	 */
	readonly startOfToday: string;
	readonly startOfMonth: string;
}

const instant = (at: DateTime.DateTime): string => DateTime.toDateUtc(at).toISOString();

export const localDays = (timeZone: DateTime.TimeZone, now: Date): LocalDays => {
	const zoned = DateTime.makeZonedUnsafe(now, { timeZone });
	const today = DateTime.formatIsoDate(zoned);
	return {
		at: now.toISOString(),
		today,
		month: today.slice(0, 7),
		// On a day whose midnight doesn't exist (summer time starting at 00:00), the day starts at
		// its first real instant; on one with two midnights, at the first.
		startOfToday: instant(DateTime.startOf(zoned, "day")),
		startOfMonth: instant(DateTime.startOf(zoned, "month")),
	};
};

/** The local calendar now, from one reading of the clock. */
export const daysNow = (ctx: Context): LocalDays => localDays(ctx.timeZone, ctx.now());
