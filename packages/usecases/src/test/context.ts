/**
 * A use case's surroundings for tests: a `Context` in a temporary folder with a fixed clock, and
 * keys only when a test names them. Only tests import this folder.
 */

import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DateTime, Redacted } from "effect";
import { onTestFinished } from "vitest";
import type { Context } from "../context.ts";

/** The time every test context reads: 2026-11-04, 09:00 UTC. */
export const NOW = new Date("2026-11-04T09:00:00Z");

/** A new empty folder, removed when the test finishes. */
export const tempDir = (): string => {
	// realpath: macOS hands out /var/… paths that are really /private/var/….
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "shorts-studio-test-")));
	onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
	return dir;
};

/** A Context in a temporary folder. No API key is set unless `secrets` names its variable. */
export const testContext = (
	overrides: Partial<Context> & { readonly secrets?: Readonly<Record<string, string>> } = {},
): Context => {
	const root = tempDir();
	const { secrets = {}, ...rest } = overrides;
	return {
		paths: { data: join(root, "data"), posts: join(root, "posts") },
		config: {},
		brand: {},
		settingsIssues: [],
		settingsWarnings: [],
		secret: async (key) => {
			const value = secrets[key.env];
			return value === undefined ? undefined : Redacted.make(value);
		},
		now: () => NOW,
		timeZone: DateTime.zoneMakeNamedUnsafe("UTC"),
		interactive: true,
		log: () => {},
		...rest,
	};
};
