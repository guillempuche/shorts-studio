/**
 * A use case's surroundings for tests: a `Context` in a temporary folder with a fixed clock, and
 * keys only when a test names them. Only tests import this folder.
 */

import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DateTime, Redacted } from "effect";
import { onTestFinished } from "vitest";
import type { CapsFrom, Context, SettingsIssue } from "../context.ts";

/** The time every test context reads: 2026-11-04, 09:00 UTC. */
export const NOW = new Date("2026-11-04T09:00:00Z");

/** A config.json value that isn't valid, as the settings report it: the caps may be the defaults. */
export const BROKEN_CONFIG: SettingsIssue = {
	source: "/data/config.json",
	risk: "caps",
	text: 'captions.fontSize: Expected a number, got "big"',
};

/** A new empty folder, removed when the test finishes. */
export const tempDir = (): string => {
	// realpath: macOS hands out /var/… paths that are really /private/var/….
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "shorts-studio-test-")));
	onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
	return dir;
};

/**
 * A Context in a temporary folder. No API key is set unless `secrets` names its variable. A cap
 * `config` sets reads as set in config.json, unless `capsFrom` says otherwise.
 */
export const testContext = (
	overrides: Partial<Context> & { readonly secrets?: Readonly<Record<string, string>> } = {},
): Context => {
	const root = tempDir();
	const { secrets = {}, ...rest } = overrides;
	const paths = rest.paths ?? { data: join(root, "data"), posts: join(root, "posts") };
	const capFrom = (cap: keyof CapsFrom) =>
		rest.config?.caps?.[cap] === undefined ? "default" : join(paths.data, "config.json");
	return {
		paths,
		pathsFrom: { data: undefined, posts: undefined },
		config: {},
		brand: {},
		capsFrom: {
			dailyUsd: capFrom("dailyUsd"),
			monthlyUsd: capFrom("monthlyUsd"),
			postUsd: capFrom("postUsd"),
		},
		settingsIssues: [],
		settingsWarnings: [],
		secret: async (key) => {
			const value = secrets[key.env];
			return value === undefined ? undefined : Redacted.make(value);
		},
		now: () => NOW,
		// As on Windows: no process's start is known, so a lock is judged as before the probe.
		processStartedAt: async () => undefined,
		timeZone: DateTime.zoneMakeNamedUnsafe("UTC"),
		interactive: true,
		agentShell: undefined,
		log: () => {},
		...rest,
	};
};
