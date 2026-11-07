/**
 * Test helper for the providers: a `ProviderContext` in a temporary folder. Paid services point
 * at a closed local port unless a test gives their URL, so nothing reaches the real ones. Only
 * tests import this file.
 */

import type { Context } from "@shorts-studio/usecases/context";
import { testContext } from "@shorts-studio/usecases/test/context";
import type { ProviderContext } from "../node.ts";
import { runProcess } from "../process.ts";

export const providerContext = (
	overrides: Partial<ProviderContext> & {
		readonly secrets?: Readonly<Record<string, string>>;
	} = {},
): ProviderContext => {
	const { endpoints, run, secrets, ...rest } = overrides;
	const ctx: Context = testContext({ ...rest, ...(secrets !== undefined ? { secrets } : {}) });
	return {
		...ctx,
		endpoints: endpoints ?? { fal: "http://127.0.0.1:1", together: "http://127.0.0.1:1" },
		run: run ?? runProcess,
	};
};
