import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["test/**/*.integration.test.ts"],
		fileParallelism: false,
		testTimeout: 120_000,
	},
});
