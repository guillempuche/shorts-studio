/** Models for tests. Only tests import this file. */

import type { Model } from "@shorts-studio/domain/models";
import type { OwnModels } from "../ports.ts";

/** The provider's default model, which every provider must have among its own. */
export const defaultModelOf = (provider: OwnModels): Model => {
	const model = provider.models[provider.defaultModel];
	if (model === undefined) throw new Error(`No model "${provider.defaultModel}" of its own.`);
	return model;
};
