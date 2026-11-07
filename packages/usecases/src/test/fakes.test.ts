import { fakeImageMaker, fakeTranscriber } from "./fakes.ts";
import { imageMakerContract } from "./image-maker.contract.ts";
import { transcriberContract } from "./transcriber.contract.ts";

// The fakes the use-case tests rely on behave like the real providers, so those tests mean
// something.

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
