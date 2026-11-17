/**
 * Test helper for the providers: a `ProviderContext` in a temporary folder. Paid services point
 * at a closed local port unless a test gives their URL, so nothing reaches the real ones. Only
 * tests import this file.
 */

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
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

/**
 * The address of a local port that was open a moment ago, so connecting to it is refused, as a
 * service that can't be reached is. Not a port fetch blocks by itself, such as the 1 above.
 */
export const closedUrl = async (): Promise<string> => {
	const server = createServer();
	await new Promise<void>((listening) => server.listen(0, "127.0.0.1", () => listening()));
	const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	await new Promise<void>((closed) => server.close(() => closed()));
	return url;
};
