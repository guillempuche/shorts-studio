import { describe, expect, it } from "vitest";
import { approvalOf, changesSinceApproval, type Post, stageOf } from "./post.ts";

const post = (fields: Partial<Post> = {}): Post => ({
	manifestVersion: 1,
	slug: "2026-11-04-stage",
	createdAt: "2026-11-04T09:00:00.000Z",
	revision: 1,
	...fields,
});

const draft = (hash: string) => ({
	file: "draft.mp4",
	hash,
	inputHash: "x",
	rendererVersion: 1,
	durationSec: 4,
});

describe("stageOf", () => {
	it("should count a review only for the draft it was made on", () => {
		// GIVEN a draft the user approved
		const approved = post({
			draft: draft("d1"),
			review: { decision: "approve", at: "2026-11-04T20:00:00.000Z", draftHash: "d1" },
		});

		// WHEN the draft is rendered again, so its hash changes
		const rendered = post({ ...approved, draft: draft("d2") });

		// THEN the first is approved and the new draft waits for a review
		expect(stageOf(approved)).toBe("approved");
		expect(stageOf(rendered)).toBe("draft");
	});

	it("should count a script approval only for the script that was approved", () => {
		// GIVEN a script approved, then edited
		const edited = post({ script: { file: "script.md", hash: "new", approvedHash: "old" } });

		// THEN the post waits for the user to approve the new script
		expect(stageOf(edited)).toBe("script-ready");
	});

	it("should count a script approval only for the audio and prompts that were approved", () => {
		// GIVEN a post with audio and two prompted beats, as the user approved it
		const audio = {
			file: "audio/audio.m4a",
			hash: "a1",
			origin: "mine",
			kind: "speech",
			durationSec: 4,
			source: "voice.m4a",
		} as const;
		const door = { index: 0, start: 0, end: 2, text: "one", prompt: "a red door" };
		const sky = { index: 1, start: 2, end: 4, text: "two", prompt: "a blue sky" };
		const ready = post({
			script: { file: "script.md", hash: "s" },
			audio,
			beats: { inputHash: "b", items: [door, sky] },
		});
		const approved = post({
			...ready,
			script: { file: "script.md", hash: "s", ...approvalOf(ready) },
		});

		// WHEN beat 1's prompt changes, or new audio is imported
		const reprompted = post({
			...approved,
			beats: { inputHash: "b", items: [door, { ...sky, prompt: "fire" }] },
		});
		const newAudio = post({ ...approved, audio: { ...audio, hash: "a2" } });

		// THEN only the post as approved counts as approved, and each change is named
		expect(stageOf(approved)).toBe("assets");
		expect(changesSinceApproval(approved)).toEqual([]);
		expect(stageOf(reprompted)).toBe("script-ready");
		expect(changesSinceApproval(reprompted)).toEqual(["the prompt of beat 1"]);
		expect(stageOf(newAudio)).toBe("script-ready");
		expect(changesSinceApproval(newAudio)).toEqual(["the audio"]);
	});
});
