/**
 * The models a job can use: the provider's own, changed or added to by config.json's `models`.
 * A use case picks one here and hands the whole model to the provider, so a model added in
 * config.json works without code.
 */

import { join } from "node:path";
import { fail, type ShortsError } from "@shorts-studio/domain/errors";
import { type Job, Model } from "@shorts-studio/domain/models";
import { Effect, Schema } from "effect";
import type { Context } from "./context.ts";
import type { OwnModels, ProviderInfo } from "./ports.ts";

/** A model and the name it was chosen by, which is what post.json and the ledger record. */
export type NamedModel = Model & { readonly name: string };

type Offer = Pick<ProviderInfo, "provider"> & OwnModels;

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
	const names = Object.keys(models);
	if (names.length === 0) {
		return yield* fail(
			"usage",
			`The ${job} provider "${offer.provider}" offers no models.`,
			`Check ${job}.provider in config.json; doctor shows what's wrong with it.`,
		);
	}
	const name = wanted ?? ctx.config[job]?.model ?? offer.defaultModel;
	const model = models[name];
	if (model === undefined) {
		return yield* fail(
			"usage",
			`The ${offer.provider} ${job} provider has no model "${name}".`,
			`Use one of: ${names.join(", ")}. Or add it under models in config.json.`,
		);
	}
	return { ...model, name } satisfies NamedModel;
});
