import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		// Tests that need ffmpeg, the network or a paid API are opt-in: pnpm test:integration.
		exclude: [...configDefaults.exclude, "**/*.integration.test.ts", "docs/vendors/**"],
		passWithNoTests: true,
	},
});
