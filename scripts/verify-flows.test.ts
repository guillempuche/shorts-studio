import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { FLOWS, flowsFor, NO_FLOW } from "./verify-flows.ts";

const ids = (paths: ReadonlyArray<string>) => flowsFor(paths).map((flow) => flow.id);

describe("flowsFor", () => {
	it("should need the cli and mcp flows for a change to an operation", () => {
		// GIVEN a change to an operation, which both the CLI and MCP serve
		const paths = ["packages/usecases/src/operations/script.ts"];

		// WHEN the flows are picked
		const flows = ids(paths);

		// THEN both surfaces are walked
		expect(flows).toEqual(["cli", "mcp"]);
	});

	it("should need the provider and render flows for a change to the ffmpeg renderer", () => {
		// GIVEN a change to the renderer, which is a provider that draws the video
		const paths = ["packages/providers/src/ffmpeg-render.ts"];

		// WHEN the flows are picked
		const flows = ids(paths);

		// THEN the provider is tried and the frames are looked at
		expect(flows).toEqual(["provider", "render"]);
	});

	it("should need no flow for tests, test helpers, docs and generated skills", () => {
		// GIVEN a change no user runs
		const paths = [
			"packages/usecases/src/beats.test.ts",
			"packages/usecases/src/test/fakes.ts",
			"docs/architecture.md",
			".agents/skills/openspec-explore/SKILL.md",
		];

		// WHEN the flows are picked
		const flows = ids(paths);

		// THEN nothing needs walking
		expect(flows).toEqual([]);
	});

	it("should name every file under apps/, packages/ and bin/ in a flow or as needing none", () => {
		// GIVEN every tracked file a user's run could reach
		const tracked = execFileSync("git", ["ls-files", "apps", "packages", "bin"], {
			encoding: "utf8",
		})
			.split("\n")
			.filter(Boolean);

		// WHEN each is matched against the map
		const unmapped = tracked.filter(
			(path) =>
				!NO_FLOW.some((pattern) => pattern.test(path)) &&
				!FLOWS.some((flow) => flow.paths.some((prefix) => path.startsWith(prefix))),
		);

		// THEN none is left out: a new file gets a flow, or a NO_FLOW pattern with a reason
		expect(unmapped).toEqual([]);
	});
});
