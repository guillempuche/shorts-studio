/** Opt-in tests that need ffmpeg, the network or a paid API: pnpm test:integration. */

import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["src/**/*.integration.test.ts"],
		fileParallelism: false,
		passWithNoTests: true,
		testTimeout: 120_000,
	},
});
