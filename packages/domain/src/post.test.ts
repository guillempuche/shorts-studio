import { describe, expect, it } from "vitest";
import { type Post, stageOf } from "./post.ts";

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
});
