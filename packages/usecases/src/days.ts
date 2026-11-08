/**
 * Days and months in the machine's time zone, not UTC: a call made at 00:30 counts toward the
 * new day's cap, and a post made then is dated that day.
 */

import { DateTime } from "effect";
import type { Context } from "./context.ts";

const zonedNow = (ctx: Context) => DateTime.makeZonedUnsafe(ctx.now(), { timeZone: ctx.timeZone });

/**
 * The first instant of the local day or month, as a UTC instant written like the ledger's `at`
 * (`toISOString`). Those strings sort in time order, so a ledger line is from today when its
 * `at` is at least today's start: no date maths for each of the thousands of lines.
 */
const startOf = (ctx: Context, unit: "day" | "month"): string =>
	DateTime.toDateUtc(DateTime.startOf(zonedNow(ctx), unit)).toISOString();

export const startOfToday = (ctx: Context): string => startOf(ctx, "day");

export const startOfThisMonth = (ctx: Context): string => startOf(ctx, "month");

/** Today's local date, as YYYY-MM-DD. */
export const today = (ctx: Context): string => DateTime.formatIsoDate(zonedNow(ctx));

/** This local month, as YYYY-MM. */
export const thisMonth = (ctx: Context): string => today(ctx).slice(0, 7);
