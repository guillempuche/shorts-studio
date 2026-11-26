// Fails when a pull request's `## Verification` section doesn't prove the change was walked.
//
//   PR_BODY="$(gh pr view --json body -q .body)" node scripts/check-verification.ts [base]
//
// The section's shape is the verify skill's (.agents/skills/verify/SKILL.md, step 5). This checks
// that every flow the change needs (scripts/verify-flows.ts) has a row, that no step failed, that
// every step not walked says why, and that `### Checks` comes last.

import { changedPaths, FLOWS, flowsFor } from "./verify-flows.ts";

const RESULTS = new Set(["pass", "fail", "not walked"]);

/** The text under `## <heading>` up to the next `## ` heading, without HTML comments. */
const section = (markdown: string, heading: string): string | undefined => {
	const text = markdown.replace(/<!--[\s\S]*?-->/g, "");
	const start = text.search(new RegExp(`^## ${heading}\\s*$`, "m"));
	if (start === -1) return undefined;
	const afterHeading = text.slice(start).split("\n").slice(1).join("\n");
	const end = afterHeading.search(/^## /m);
	return end === -1 ? afterHeading : afterHeading.slice(0, end);
};

/** Each `### <name>` subsection's lines, in order. */
const subsections = (text: string): ReadonlyArray<{ name: string; lines: ReadonlyArray<string> }> =>
	text
		.split(/^### /m)
		.slice(1)
		.map((part) => {
			const [name = "", ...lines] = part.split("\n");
			return { name: name.trim(), lines: lines.map((line) => line.trim()).filter(Boolean) };
		});

/** The table's rows as [flow, walked on, result], skipping its header and divider. */
const rows = (text: string): ReadonlyArray<ReadonlyArray<string>> =>
	text
		.split("\n")
		.filter((line) => line.trim().startsWith("|"))
		.map((line) =>
			line
				.trim()
				.replace(/^\||\|$/g, "")
				.split("|")
				.map((cell) => cell.trim()),
		)
		.filter((cells) => !/^-+$/.test(cells[0] ?? "") && cells[0]?.toLowerCase() !== "flow");

/** Every problem with a PR body, given the flows its change needs; empty when it's sound. */
export const problems = (body: string, needed: ReadonlyArray<string>): ReadonlyArray<string> => {
	const verification = section(body, "Verification");
	if (verification === undefined) return ["No `## Verification` section: run the verify skill."];
	if (verification.trim() === "") return ["`## Verification` is empty: run the verify skill."];

	const parts = subsections(verification);
	const found: Array<string> = [];
	const last = parts.at(-1);
	if (last?.name !== "Checks") found.push("`### Checks` must be the last subsection.");

	const table = rows(verification);
	if (table.length === 0) {
		if (needed.length > 0) {
			found.push(`No flow table, but the change needs: ${needed.join(", ")}.`);
		} else if (!/^No flow: \S/m.test(verification)) {
			found.push("Write the flow table, or `No flow: <reason>` when nothing needs one.");
		}
		return found;
	}

	const known = new Set(FLOWS.map((flow) => flow.id));
	const listed = new Set(table.map((cells) => cells[0] ?? ""));
	for (const id of needed) {
		if (!listed.has(id)) found.push(`Flow \`${id}\` isn't in the table, and the change needs it.`);
	}
	for (const [id = "", , result = ""] of table) {
		if (!known.has(id)) found.push(`Unknown flow \`${id}\`: add it to scripts/verify-flows.ts.`);
		if (!RESULTS.has(result))
			found.push(`Flow \`${id}\`: result must be pass, fail or not walked.`);
		if (result === "fail") found.push(`Flow \`${id}\` failed: fix it before merging.`);

		const steps = parts
			.find((part) => part.name === id)
			?.lines.filter((line) => line.startsWith("- "));
		if (steps === undefined || steps.length === 0) {
			found.push(`Flow \`${id}\` has no \`### ${id}\` with its steps.`);
		} else if (result === "not walked" && !steps.some((step) => /not walked: \S/.test(step))) {
			found.push(
				`Flow \`${id}\` wasn't walked: one of its steps must say \`not walked: <reason>\`.`,
			);
		}
	}
	return found;
};

if (import.meta.main) {
	const base = process.argv[2] ?? "origin/main";
	const needed = flowsFor(changedPaths(base)).map((flow) => flow.id);
	const found = problems(process.env["PR_BODY"] ?? "", needed);
	if (found.length > 0) {
		console.error(`The pull request's Verification section needs work:\n  ${found.join("\n  ")}`);
		process.exitCode = 1;
	} else {
		console.log(
			`Verification covers ${needed.length > 0 ? needed.join(", ") : "a change with no flow"}.`,
		);
	}
}
