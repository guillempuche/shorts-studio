/**
 * The models a job can use: the provider's own, changed or added to by config.json's `models`.
 * A use case picks one here and hands the whole model to the provider, so a model added in
 * config.json works without code.
 */

import { join } from "node:path";
import { fail, issueLine, type ShortsError } from "@shorts-studio/domain/errors";
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

const decodeModel = Schema.decodeUnknownResult(Model);

/** Every model `offer`'s provider has for `job`, after config.json's changes and additions. */
export const modelsFor = (
	ctx: Context,
	offer: Offer,
	job: Job,
): Effect.Effect<Readonly<Record<string, Model>>, ShortsError> => {
	const { models, problems } = readModels(ctx, offer, job);
	return problems[0] === undefined ? Effect.succeed(models) : Effect.fail(problems[0]);
};

/**
 * Like `modelsFor`, but keeps going past an entry that isn't a whole model, so `models list` can
 * show everything else and name what to fix.
 */
export const readModels = (
	ctx: Context,
	offer: Offer,
	job: Job,
): {
	readonly models: Readonly<Record<string, Model>>;
	readonly problems: ReadonlyArray<ShortsError>;
} => {
	const configured = ctx.config.models ?? {};
	const names = new Set([
		...Object.keys(offer.models),
		...Object.keys(configured).filter((name) => configured[name]?.provider === offer.provider),
	]);
	const models: Record<string, Model> = {};
	const problems: Array<ShortsError> = [];
	for (const name of names) {
		const decoded = decodeModel({ ...ownEntry(offer.models, name), ...ownEntry(configured, name) });
		if (Result.isFailure(decoded)) {
			problems.push(
				fail(
					"usage",
					`models.${name} in config.json isn't a whole model: ${issueLine(decoded.failure)}`,
					`Fix it in ${join(ctx.paths.data, "config.json")}. A new model needs provider, job, endpoint, billedBy, usdPerUnit and priceChecked.`,
				),
			);
		} else if (decoded.success.provider === offer.provider && decoded.success.job === job) {
			models[name] = decoded.success;
		}
	}
	return { models, problems };
};

/** `record[name]` only when the record itself has it: "constructor" isn't a model name. */
const ownEntry = <A>(record: Readonly<Record<string, A>>, name: string): A | undefined =>
	Object.hasOwn(record, name) ? record[name] : undefined;

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
	const model = ownEntry(models, name);
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
 * would; a price in use checked more than `STALE_PRICE_DAYS` ago, or dated after today, warns; so
 * does a model in config.json that no provider in use claims, which is often a misspelt name.
 */
export const modelChecks = Effect.fn("modelChecks")(function* (
	ctx: Context,
	offers: ReadonlyArray<{ readonly job: Job; readonly offer: Offer }>,
): Effect.fn.Return<ReadonlyArray<Check>> {
	const { today } = daysNow(ctx);
	const configFile = join(ctx.paths.data, "config.json");
	const rows: Array<Check> = [];

	// A provider with no models of its own is one the settings name wrongly; its own row says so.
	for (const { job, offer } of offers.filter(({ offer }) => Object.keys(offer.models).length > 0)) {
		const chosen = yield* Effect.result(chooseModel(ctx, offer, job));
		if (Result.isFailure(chosen)) {
			const { message, fix } = chosen.failure;
			rows.push({ name: `${job} model`, status: "fail", detail: message, fix });
			continue;
		}
		const model = chosen.success;
		const age = daysBetween(model.priceChecked, today);
		if (age < 0) {
			rows.push({
				name: `${job} model`,
				status: "warn",
				detail: `${model.name}'s price says it was checked on ${model.priceChecked}, which is after today.`,
				fix: `Set models.${model.name}.priceChecked in ${configFile} to the day you checked it.`,
			});
		}
		if (age > STALE_PRICE_DAYS) {
			rows.push({
				name: `${job} model`,
				status: "warn",
				detail: `${model.name}'s price ($${model.usdPerUnit} per ${model.billedBy}) was checked ${age} days ago, on ${model.priceChecked}.`,
				fix: `Check it on ${model.provider}'s site, then set models.${model.name}.usdPerUnit and priceChecked in ${configFile}.`,
			});
		}
	}

	// A provider in use claims an entry when it is one of its own models, or when the entry
	// names that provider and the job it does. One with no job is incomplete, which the job's
	// own row already reports.
	const claimed = (name: string, settings: { readonly provider?: string; readonly job?: Job }) =>
		offers.some(
			({ job, offer }) =>
				Object.hasOwn(offer.models, name) ||
				(settings.provider === offer.provider && (settings.job ?? job) === job),
		);
	for (const [name, settings] of Object.entries(ctx.config.models ?? {})) {
		if (claimed(name, settings)) continue;
		rows.push({
			name: "models",
			status: "warn",
			detail: `models.${name} in config.json belongs to no provider in use, so nothing uses it.`,
			fix: "Check its name against models list, or give it the provider and job it's for.",
		});
	}
	return rows;
});
