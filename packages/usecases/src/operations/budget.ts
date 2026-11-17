/**
 * `budget show`: what has been spent today, this month and on each post, against the caps, and
 * where each cap was set. It reads the ledger, so a paid call that hasn't finished yet counts at
 * its estimate. It lists the settings that can't be used, since its caps may then be the
 * defaults, and an MCP client sees no stderr warning.
 */

import { Effect, Schema } from "effect";
import { CapsFrom, capSetBy, SettingsIssue } from "../context.ts";
import { daysNow } from "../days.ts";
import { caps, readLedger, spent } from "../ledger.ts";
import { roundUsd, usd, usdOf } from "../money.ts";
import { defineOperation, p } from "../operation.ts";

export const budgetShow = defineOperation({
	name: "budget_show",
	description:
		"Show today's spend, this month's and each post's total against the daily, monthly and per-post caps, where each cap was set, and every setting that can't be used. Days and months follow the machine's time zone.",
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
		capsFrom: CapsFrom,
		settingsIssues: Schema.Array(SettingsIssue),
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
				todayUsd: roundUsd(spent(entries, { since: days.startOfToday })),
				dailyCapUsd: roundUsd(dailyUsd),
				month: days.month,
				monthUsd: roundUsd(spent(entries, { since: days.startOfMonth })),
				monthlyCapUsd: roundUsd(monthlyUsd),
				postCapUsd: roundUsd(postUsd),
				posts: names
					.map((post) => ({ post, usd: roundUsd(spent(entries, { post })) }))
					.sort((a, b) => b.usd - a.usd),
				capsFrom: ctx.capsFrom,
				settingsIssues: ctx.settingsIssues,
			};
		}),
	render: (o) =>
		[
			`Today (${o.day}): ${usdOf(o.todayUsd, o.dailyCapUsd).join(" of ")} (${capSetBy(o.capsFrom.dailyUsd)})`,
			`This month (${o.month}): ${usdOf(o.monthUsd, o.monthlyCapUsd).join(" of ")} (${capSetBy(o.capsFrom.monthlyUsd)})`,
			`Per post: ${usd(o.postCapUsd)} (${capSetBy(o.capsFrom.postUsd)})`,
			...o.posts.map((row) => {
				const [spentUsd, capUsd] = usdOf(row.usd, o.postCapUsd);
				return `  ${spentUsd.padStart(7)} of ${capUsd}  ${row.post}`;
			}),
		].join("\n"),
});
