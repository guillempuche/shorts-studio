import { describe, expect, it } from "vitest";
import { problems } from "./check-verification.ts";

const body = (verification: string) => `## What and why\n\nA change.\n\n${verification}`;

const SOUND = body(`## Verification

| Flow | Walked on | Result |
| --- | --- | --- |
| cli | sandbox, fake keys | pass |
| mcp | sandbox, mcp serve | not walked |

### cli

- \`post show --post demo --json\` → exit 0, \`next.cli\` is \`beat plan --post demo\`. pass

### mcp

- \`tools/call post_show\` → not walked: the MCP client wasn't available here.

### Checks

- \`pnpm check\` and \`pnpm test\`.
`);

describe("problems", () => {
	it("should accept a section that walked every flow the change needs", () => {
		// GIVEN a section with a passed flow and one not walked, with its reason

		// WHEN it is checked against the flows the change needs
		const found = problems(SOUND, ["cli", "mcp"]);

		// THEN nothing is wrong
		expect(found).toEqual([]);
	});

	it("should refuse a body with no Verification section, or only the template's comment", () => {
		// GIVEN a body without the section, and one with the PR template's comment alone
		const missing = body("## Checks\n\n- [x] pass");
		const template = body("## Verification\n\n<!-- What you ran. -->\n\n## Checks\n");

		// WHEN each is checked
		const found = [problems(missing, []), problems(template, [])];

		// THEN both say to run the verify skill
		expect(found).toEqual([
			["No `## Verification` section: run the verify skill."],
			["`## Verification` is empty: run the verify skill."],
		]);
	});

	it("should name a needed flow the table leaves out", () => {
		// GIVEN a section that walked cli and mcp, for a change that also needs the provider flow

		// WHEN it is checked
		const found = problems(SOUND, ["cli", "mcp", "provider"]);

		// THEN the missing flow is named
		expect(found).toEqual(["Flow `provider` isn't in the table, and the change needs it."]);
	});

	it("should refuse a failed flow and one not walked without a reason", () => {
		// GIVEN a failed cli flow, and an mcp flow not walked whose step gives no reason
		const section = SOUND.replace("| pass |", "| fail |").replace(
			"→ not walked: the MCP client wasn't available here.",
			"→ skipped.",
		);

		// WHEN it is checked
		const found = problems(section, ["cli", "mcp"]);

		// THEN both are reported
		expect(found).toEqual([
			"Flow `cli` failed: fix it before merging.",
			"Flow `mcp` wasn't walked: one of its steps must say `not walked: <reason>`.",
		]);
	});

	it("should accept No flow with a reason when nothing needs walking", () => {
		// GIVEN a docs-only change's section
		const section = body(
			"## Verification\n\nNo flow: docs only.\n\n### Checks\n\n- `pnpm check-links`.\n",
		);

		// WHEN it is checked with no flow needed
		const found = problems(section, []);

		// THEN nothing is wrong
		expect(found).toEqual([]);
	});

	it("should refuse No flow when the change needs a flow", () => {
		// GIVEN a section that says no flow, for a change to a command
		const section = body("## Verification\n\nNo flow: small.\n\n### Checks\n\n- `pnpm test`.\n");

		// WHEN it is checked
		const found = problems(section, ["cli"]);

		// THEN the needed flow is named
		expect(found).toEqual(["No flow table, but the change needs: cli."]);
	});

	it("should refuse a flow the map doesn't know and Checks that isn't last", () => {
		// GIVEN an invented flow, and Checks moved before the flows' steps
		const section = body(`## Verification

| Flow | Walked on | Result |
| --- | --- | --- |
| magic | sandbox | pass |

### Checks

- \`pnpm test\`.

### magic

- Did it. pass
`);

		// WHEN it is checked
		const found = problems(section, []);

		// THEN both are reported
		expect(found).toEqual([
			"`### Checks` must be the last subsection.",
			"Unknown flow `magic`: add it to scripts/verify-flows.ts.",
		]);
	});
});
