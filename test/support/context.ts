/**
 * A Context for tests: a temporary data folder, no keys unless given, and the real `run`
 * and `fetch` unless replaced.
 */

import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context, SecretName } from "../../src/core/context.ts";
import { runProcess } from "../../src/core/process.ts";

export interface TestContext extends Context {
	readonly cleanup: () => void;
}

export const makeTestContext = (
	overrides: Partial<Context> & { readonly secrets?: Partial<Record<SecretName, string>> } = {},
): TestContext => {
	// realpath: macOS hands out /var/… paths that are really /private/var/….
	const root = realpathSync(mkdtempSync(join(tmpdir(), "shorts-studio-test-")));
	const { secrets = {}, ...rest } = overrides;
	return {
		paths: { data: join(root, "data"), posts: join(root, "posts") },
		endpoints: { fal: "http://127.0.0.1:1", together: "http://127.0.0.1:1" },
		config: {},
		brand: {},
		secret: async (name) => secrets[name],
		fetch: globalThis.fetch,
		run: runProcess,
		now: () => new Date("2026-11-04T09:00:00Z"),
		log: () => {},
		...rest,
		cleanup: () => rmSync(root, { recursive: true, force: true }),
	};
};
