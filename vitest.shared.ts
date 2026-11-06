/**
 * The test setup every package uses (its vitest.config.ts points here). Tests sit beside the
 * module they test: src/beats.ts and src/beats.test.ts.
 */

import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["src/**/*.test.ts"],
		// Tests that need ffmpeg, the network or a paid API are opt-in: pnpm test:integration.
		exclude: [...configDefaults.exclude, "src/**/*.integration.test.ts"],
		passWithNoTests: true,
	},
});
