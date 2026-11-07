/**
 * Models as data: what each paid model is called, where it's sent and what it costs. Providers
 * ship the models they know, and config.json can add more or change a price, so a new model
 * from a family a provider already handles needs no code.
 */

import { Schema, Struct } from "effect";
import { IMAGE_SIZE } from "./direction.ts";

export const Job = Schema.Literals(["image", "transcribe"]);
export type Job = typeof Job.Type;

/** What a provider bills a call by. */
export const Unit = Schema.Literals(["megapixel", "image", "second", "character", "minute"]);
export type Unit = typeof Unit.Type;

/** The units each job can be billed by; a model billed any other way can't be priced. */
export const UNITS_BY_JOB: Readonly<Record<Job, ReadonlyArray<Unit>>> = {
	image: ["megapixel", "image"],
	transcribe: ["minute", "second"],
};

/** A value sent with every request to a model, such as FAL's `num_inference_steps`. */
const OptionValue = Schema.Union([Schema.String, Schema.Finite, Schema.Boolean]);

const ModelFields = Schema.Struct({
	provider: Schema.String.annotate({ description: 'The provider that runs it, e.g. "fal".' }),
	job: Job.annotate({ description: "The job it does." }),
	endpoint: Schema.String.annotate({
		description: "What the provider calls it: a path on FAL, a model id on Together.",
	}),
	billedBy: Unit.annotate({ description: "The unit the provider bills it by." }),
	usdPerUnit: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)).annotate({
		description: "Price of one unit in US dollars. On a plan, what one unit costs on it.",
	}),
	roundUp: Schema.optionalKey(
		Schema.Boolean.annotate({
			description: "Billed in whole units, rounded up: FAL bills 3.2 megapixels as 4.",
		}),
	),
	priceChecked: Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/u)).annotate({
		description: "The day the price was last checked on the provider's site, as YYYY-MM-DD.",
	}),
	options: Schema.optionalKey(
		Schema.Record(Schema.String, OptionValue).annotate({
			description: "Fields sent with every request, e.g. FAL's num_inference_steps.",
		}),
	),
});

export const Model = ModelFields.check(
	Schema.makeFilter((model) =>
		UNITS_BY_JOB[model.job].includes(model.billedBy)
			? undefined
			: {
					path: ["billedBy"],
					issue: `a ${model.job} model is billed by ${UNITS_BY_JOB[model.job].join(" or ")}`,
				},
	),
);
export type Model = typeof Model.Type;

/**
 * A model as config.json sets it. Every field is optional: changing a price only needs the
 * price and the day it was checked. Once merged with the built-in model of the same name, it
 * must be a whole `Model`.
 */
export const ModelSettings = ModelFields.mapFields(Struct.map(Schema.optionalKey));
export type ModelSettings = typeof ModelSettings.Type;

/** What a call costs: its amount in the model's unit, rounded up if billed whole, times the price. */
export const price = (model: Model, amount: number) => {
	const units = model.roundUp === true ? Math.ceil(amount) : amount;
	return { units, usd: units * model.usdPerUnit };
};

/** How much of an image model's unit one image at `IMAGE_SIZE` is. */
export const imageAmount = (model: Model): number =>
	model.billedBy === "megapixel" ? (IMAGE_SIZE.width * IMAGE_SIZE.height) / 1_000_000 : 1;
