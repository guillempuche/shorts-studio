import { Transcriber } from "@shorts-studio/usecases/ports";
import { transcriberContract } from "@shorts-studio/usecases/test/transcriber.contract";
import { Effect } from "effect";
import { onTestFinished } from "vitest";
import { withEnv } from "./env.ts";
import { providerContext } from "./test/context.ts";
import { startFakeTogether } from "./test/together-server.ts";
import { togetherLayer } from "./together.ts";

transcriberContract("Together", {
	make: async ({ answer, withKey }) => {
		const fake = await startFakeTogether(answer === "refused" ? { status: 500 } : {});
		onTestFinished(() => fake.close());
		const ctx = providerContext({
			endpoints: { together: fake.url },
			secrets: withKey ? { TOGETHER_API_KEY: "test-key" } : {},
		});
		return Effect.runPromise(
			Effect.gen(function* () {
				return yield* Transcriber;
			}).pipe(Effect.provide(withEnv(togetherLayer, ctx))),
		);
	},
});
