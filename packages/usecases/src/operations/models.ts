/**
 * `models list`: each job's models, from the provider in use with config.json's changes, with
 * their prices and how long ago each price was checked. Prices change without notice, so `doctor`
 * warns when the one in use wasn't checked for a while.
 */

import { Job, Unit } from "@shorts-studio/domain/models";
import { Effect, Schema } from "effect";
import { daysBetween, daysNow } from "../days.ts";
import { jobOffers, modelNameFor, readModels, STALE_PRICE_DAYS } from "../models.ts";
import { defineOperation } from "../operation.ts";

const ModelRow = Schema.Struct({
	job: Job,
	provider: Schema.String,
	name: Schema.String,
	endpoint: Schema.String,
	billedBy: Unit,
	usdPerUnit: Schema.Finite,
	roundUp: Schema.Boolean,
	priceChecked: Schema.String,
	daysSinceChecked: Schema.Int,
	inUse: Schema.Boolean,
});

export const modelsList = defineOperation({
	name: "models_list",
	description:
		"List each job's models: the provider in use's own and those config.json adds or changes, with the price per unit, the day each price was checked, and which model is in use.",
	params: {},
	output: Schema.Struct({
		models: Schema.Array(ModelRow),
		staleAfterDays: Schema.Int,
		/** Entries in config.json that aren't whole models, each with what to fix. */
		problems: Schema.Array(Schema.Struct({ message: Schema.String, fix: Schema.String })),
	}),
	surface: "cli-and-mcp",
	spends: false,
	hints: { readonly: true, destructive: false, idempotent: true, openWorld: false },
	run: Effect.fn("models_list")(function* (_input, ctx) {
		const { today } = daysNow(ctx);
		const offers = yield* jobOffers;
		const jobs = offers.map(({ job, offer }) => {
			const { models, problems } = readModels(ctx, offer, job);
			return {
				problems,
				rows: Object.entries(models).map(([name, model]) => ({
					job,
					provider: model.provider,
					name,
					endpoint: model.endpoint,
					billedBy: model.billedBy,
					usdPerUnit: model.usdPerUnit,
					roundUp: model.roundUp === true,
					priceChecked: model.priceChecked,
					daysSinceChecked: daysBetween(model.priceChecked, today),
					inUse: name === modelNameFor(ctx, offer, job),
				})),
			};
		});
		// The same bad entry can show up for each job; report it once.
		const problems = new Map(
			jobs.flatMap(({ problems }) =>
				problems.map(({ message, fix }) => [message, { message, fix }]),
			),
		);
		return {
			models: jobs.flatMap(({ rows }) => rows),
			staleAfterDays: STALE_PRICE_DAYS,
			problems: [...problems.values()],
		};
	}),
	render: (o) => {
		const jobs = [...new Set(o.models.map((m) => m.job))];
		return [
			...jobs.flatMap((job) => {
				const rows = o.models.filter((m) => m.job === job);
				const width = Math.max(...rows.map((m) => m.name.length));
				return [
					`${job}, by ${rows[0]?.provider}:`,
					...rows.map((m) => {
						const unit = `$${m.usdPerUnit} per ${m.billedBy}${m.roundUp ? ", rounded up" : ""}`;
						const age =
							m.daysSinceChecked < 0
								? "in the future, check the date"
								: `${m.daysSinceChecked} day${m.daysSinceChecked === 1 ? "" : "s"} ago`;
						const stale = m.daysSinceChecked > o.staleAfterDays ? ", check it again" : "";
						return `  ${m.inUse ? "●" : " "} ${m.name.padEnd(width)}  ${unit}, checked ${m.priceChecked} (${age}${stale})`;
					}),
				];
			}),
			"",
			"● in use. Change a price, or add a model, under models in config.json.",
			...o.problems.flatMap(({ message, fix }) => ["", `✗ ${message}`, `  → ${fix}`]),
		].join("\n");
	},
});
