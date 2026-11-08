/**
 * `budget show`: what has been spent today, this month and on each post, against the caps. It
 * reads the ledger, so a paid call that hasn't finished yet counts at its estimate.
 */

import { Effect, Schema } from "effect";
import { daysNow } from "../days.ts";
import { caps, readLedger, spent } from "../ledger.ts";
import { defineOperation, p } from "../operation.ts";

export const budgetShow = defineOperation({
	name: "budget_show",
	description:
		"Show today's spend, this month's and each post's total against the daily, monthly and per-post caps. Days and months follow the machine's time zone.",
	params: { post: p.optional(p.string("Only this post")) },
	output: Schema.Struct({
		day: Schema.String,
		todayUsd: Schema.Finite,
		dailyCapUsd: Schema.Finite,
		month: Schema.String,
		monthUsd: Schema.Finite,
		monthlyCapUsd: Schema.Finite,
		postCapUsd: Schema.Finite,
		posts: Schema.Array(Schema.Struct({ post: Schema.String, usd: Schema.Finite })),
	}),
	surface: "cli-and-mcp",
	spends: false,
	hints: { readonly: true, destructive: false, idempotent: true, openWorld: false },
	run: (input, ctx) =>
		Effect.map(readLedger(ctx), (entries) => {
			const days = daysNow(ctx);
			const names = [...new Set(entries.map((e) => e.post))].filter(
				(name) => input.post === undefined || name === input.post,
			);
			const { dailyUsd, monthlyUsd, postUsd } = caps(ctx);
			return {
				day: days.today,
				todayUsd: spent(entries, { since: days.startOfToday }),
				dailyCapUsd: dailyUsd,
				month: days.month,
				monthUsd: spent(entries, { since: days.startOfMonth }),
				monthlyCapUsd: monthlyUsd,
				postCapUsd: postUsd,
				posts: names
					.map((post) => ({ post, usd: spent(entries, { post }) }))
					.sort((a, b) => b.usd - a.usd),
			};
		}),
	render: (o) =>
		[
			`Today (${o.day}): $${o.todayUsd.toFixed(2)} of $${o.dailyCapUsd}`,
			`This month (${o.month}): $${o.monthUsd.toFixed(2)} of $${o.monthlyCapUsd}`,
			...o.posts.map(
				(row) => `  $${row.usd.toFixed(2).padStart(6)} of $${o.postCapUsd}  ${row.post}`,
			),
		].join("\n"),
});
