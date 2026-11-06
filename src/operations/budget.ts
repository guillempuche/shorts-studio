/**
 * `budget show`: what has been spent today and on each post, against the caps. It reads the
 * ledger, so a paid call that hasn't finished yet counts at its estimate.
 */

import { Effect, Schema } from "effect";
import { caps, readLedger, spent } from "../core/ledger.ts";
import { defineOperation, p } from "../core/operation.ts";

export const budgetShow = defineOperation({
	name: "budget_show",
	description: "Show today's spend and each post's total against the daily and per-post caps.",
	params: { post: p.optional(p.string("Only this post")) },
	output: Schema.Struct({
		day: Schema.String,
		todayUsd: Schema.Finite,
		dailyCapUsd: Schema.Finite,
		postCapUsd: Schema.Finite,
		posts: Schema.Array(Schema.Struct({ post: Schema.String, usd: Schema.Finite })),
	}),
	surface: "cli-and-mcp",
	spends: false,
	hints: { readonly: true, destructive: false, idempotent: true, openWorld: false },
	run: (input, ctx) =>
		Effect.map(readLedger(ctx), (entries) => {
			const day = ctx.now().toISOString().slice(0, 10);
			const names = [...new Set(entries.map((e) => e.post))].filter(
				(name) => input.post === undefined || name === input.post,
			);
			const { dailyUsd, postUsd } = caps(ctx);
			return {
				day,
				todayUsd: spent(entries, { day }),
				dailyCapUsd: dailyUsd,
				postCapUsd: postUsd,
				posts: names
					.map((post) => ({ post, usd: spent(entries, { post }) }))
					.sort((a, b) => b.usd - a.usd),
			};
		}),
	render: (o) =>
		[
			`Today (${o.day}): $${o.todayUsd.toFixed(2)} of $${o.dailyCapUsd}`,
			...o.posts.map(
				(row) => `  $${row.usd.toFixed(2).padStart(6)} of $${o.postCapUsd}  ${row.post}`,
			),
		].join("\n"),
});
