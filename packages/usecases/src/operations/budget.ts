/**
 * `budget show`: what has been spent today, this month and on each post, against the caps, and
 * where each cap was set. It reads the ledger, so a paid call that hasn't finished yet counts at
 * its estimate. It lists the settings that can't be used, since its caps may then be the
 * defaults, and an MCP client sees no stderr warning.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { Effect, Schema } from "effect";
import { CapsFrom, capSetBy, SettingsIssue } from "../context.ts";
import { daysNow } from "../days.ts";
import { caps, readLedger, spent } from "../ledger.ts";
import { roundUsd, usd, usdOf } from "../money.ts";
import { defineOperation, p } from "../operation.ts";
import { readPost } from "../post-store.ts";

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
		Effect.gen(function* () {
			const entries = yield* readLedger(ctx);
			const days = daysNow(ctx);
			const names = [...new Set(entries.map((e) => e.post))].filter(
				(name) => input.post === undefined || name === input.post,
			);
			// A name with nothing spent is still listed, at $0, when it's a post or a saved
			// collection; any other is a typo, which would otherwise read as nothing spent.
			if (input.post !== undefined && names.length === 0) {
				const collection = /^saved\/(.+)$/.exec(input.post)?.[1];
				if (collection === undefined || !existsSync(join(ctx.paths.posts, "saved", collection))) {
					// Only to fail when it's no post: not-found's fix names the post it may mean.
					yield* readPost(ctx, input.post);
				}
				names.push(input.post);
			}
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
