/**
 * The models a job can use: the provider's own, changed or added to by config.json's `models`.
 * A use case picks one here and hands the whole model to the provider, so a model added in
 * config.json works without code.
 */

import { join } from "node:path";
import { fail, type ShortsError } from "@shorts-studio/domain/errors";
import { type Job, Model, price } from "@shorts-studio/domain/models";
import { Effect, Result, Schema } from "effect";
import type { Context } from "./context.ts";
import { daysBetween, daysNow } from "./days.ts";
import type { PaidCall } from "./ledger.ts";
import { type Check, ImageMaker, type OwnModels, type ProviderInfo, Transcriber } from "./ports.ts";

/** A model and the name it was chosen by, which is what post.json and the ledger record. */
export type NamedModel = Model & { readonly name: string };

// What a provider offers: its name and its own models.
type Offer = Pick<ProviderInfo, "provider"> & OwnModels;

/** A price checked longer ago than this may be out of date: doctor warns about the one in use. */
export const STALE_PRICE_DAYS = 90;

/** Each paid job with the provider in use for it. */
export const jobOffers = Effect.gen(function* () {
	return [
		{ job: "image" as const, offer: yield* ImageMaker },
		{ job: "transcribe" as const, offer: yield* Transcriber },
	];
});

/** The model a job uses unless a command names one: config.json's, else the provider's default. */
export const modelNameFor = (ctx: Context, offer: Offer, job: Job): string =>
	ctx.config[job]?.model ?? offer.defaultModel;

const decodeModel = Schema.decodeUnknownEffect(Model);

/** Every model `offer`'s provider has for `job`, after config.json's changes and additions. */
export const modelsFor = (
	ctx: Context,
	offer: Offer,
	job: Job,
): Effect.Effect<Readonly<Record<string, Model>>, ShortsError> => {
	const configured = ctx.config.models ?? {};
	const names = new Set([
		...Object.keys(offer.models),
		...Object.keys(configured).filter((name) => configured[name]?.provider === offer.provider),
	]);

	return Effect.forEach([...names], (name) =>
		decodeModel({ ...offer.models[name], ...configured[name] }).pipe(
			Effect.map((model) => [name, model] as const),
			Effect.mapError((error) =>
				fail(
					"usage",
					`models.${name} in config.json isn't a whole model: ${error.message.replace(/\s*\n\s*/g, " ")}`,
					`Fix it in ${join(ctx.paths.data, "config.json")}. A new model needs provider, job, endpoint, billedBy, usdPerUnit and priceChecked.`,
				),
			),
		),
	).pipe(
		Effect.map((entries) =>
			Object.fromEntries(
				entries.filter(([, model]) => model.provider === offer.provider && model.job === job),
			),
		),
	);
};

/** The model to use for `job`: the one asked for, else config.json's, else the provider's default. */
export const chooseModel = Effect.fn("chooseModel")(function* (
	ctx: Context,
	offer: Offer,
	job: Job,
	wanted?: string,
) {
	const models = yield* modelsFor(ctx, offer, job);
	const available = Object.keys(models);
	if (available.length === 0) {
		return yield* fail(
			"usage",
			`The ${job} provider "${offer.provider}" offers no models.`,
			`Check ${job}.provider in config.json; doctor shows what's wrong with it.`,
		);
	}

	const name = wanted ?? modelNameFor(ctx, offer, job);
	const model = models[name];
	if (model === undefined) {
		return yield* fail(
			"usage",
			`The ${offer.provider} ${job} provider has no model "${name}".`,
			`Use one of: ${available.join(", ")}. Or add it under models in config.json.`,
		);
	}
	return { ...model, name } satisfies NamedModel;
});

/** What a call of `amount` (in the model's unit) costs, as its ledger line records it. */
export const costOf = (model: NamedModel, amount: number): Omit<PaidCall, "post" | "note"> => {
	const { units, usd } = price(model, amount);
	return {
		provider: model.provider,
		model: model.name,
		unit: model.billedBy,
		units,
		usdPerUnit: model.usdPerUnit,
		usd,
	};
};

/**
 * Doctor's rows about models: a job whose model can't be used fails, since every paid call for it
 * would; a price in use checked more than `STALE_PRICE_DAYS` ago warns; so does a model in
 * config.json that no provider in use claims, which is often a misspelt name.
 */
export const modelChecks = (
	ctx: Context,
	offers: ReadonlyArray<{ readonly job: Job; readonly offer: Offer }>,
): Effect.Effect<ReadonlyArray<Check>> =>
	Effect.gen(function* () {
		const { today } = daysNow(ctx);
		const configFile = join(ctx.paths.data, "config.json");
		const rows: Array<Check> = [];

		// A provider with no models of its own is one the settings name wrongly; its own row says so.
		for (const { job, offer } of offers.filter(
			({ offer }) => Object.keys(offer.models).length > 0,
		)) {
			const chosen = yield* Effect.result(chooseModel(ctx, offer, job));
			if (Result.isFailure(chosen)) {
				const { message, fix } = chosen.failure;
				rows.push({ name: `${job} model`, status: "fail", detail: message, fix });
				continue;
			}
			const model = chosen.success;
			const age = daysBetween(model.priceChecked, today);
			if (age > STALE_PRICE_DAYS) {
				rows.push({
					name: `${job} model`,
					status: "warn",
					detail: `${model.name}'s price ($${model.usdPerUnit} per ${model.billedBy}) was checked ${age} days ago, on ${model.priceChecked}.`,
					fix: `Check it on ${model.provider}'s site, then set models.${model.name}.usdPerUnit and priceChecked in ${configFile}.`,
				});
			}
		}

		const claimed = (name: string, provider: string | undefined) =>
			offers.some(({ offer }) => name in offer.models || provider === offer.provider);
		for (const [name, settings] of Object.entries(ctx.config.models ?? {})) {
			if (claimed(name, settings.provider)) continue;
			rows.push({
				name: "models",
				status: "warn",
				detail: `models.${name} in config.json belongs to no provider in use, so nothing uses it.`,
				fix: "Check its name against models list, or give it the provider and job it's for.",
			});
		}
		return rows;
	});
