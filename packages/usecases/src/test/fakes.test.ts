import { fakeImageMaker, fakeTranscriber } from "./fakes.ts";
import { imageMakerContract } from "./image-maker.contract.ts";
import { transcriberContract } from "./transcriber.contract.ts";

// Use-case tests rely on these fakes, so the fakes pass the same contracts as real providers.

imageMakerContract("the in-memory fake", {
	make: async ({ answer }) => {
		const maker = fakeImageMaker();
		maker.answer = answer;
		return maker;
	},
});

transcriberContract("the in-memory fake", {
	make: async ({ answer }) => fakeTranscriber(undefined, { refuses: answer === "refused" }),
});
