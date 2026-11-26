// The repository scripts' own tests, beside each script (verify-flows.ts and verify-flows.test.ts).

import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["scripts/*.test.ts"],
	},
});
