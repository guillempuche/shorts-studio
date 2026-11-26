// Which flows the verify skill walks for a change, and what each one checks.
//
//   node scripts/verify-flows.ts [base]   the flows this branch touches (default base: origin/main)
//
// The verify skill reads this map to pick the flows, and scripts/check-verification.ts reads it to
// check that a pull request walked them. A change that adds a command or a kind of output adds its
// flow here; the test fails while a file under apps/ or packages/ belongs to no flow.

import { execFileSync } from "node:child_process";

export interface Flow {
	readonly id: string;
	/** Path prefixes that need this flow, from the repository root. */
	readonly paths: ReadonlyArray<string>;
	/** What to do and what to look for, in one or two sentences. */
	readonly walk: string;
}

export const FLOWS: ReadonlyArray<Flow> = [
	{
		id: "cli",
		paths: ["apps/cli/", "packages/usecases/src/", "packages/domain/src/", "bin/"],
		walk: "The changed command's --help, then the command on a sandbox post, with and without --json. Check the output, the exit code and nextSteps.",
	},
	{
		id: "mcp",
		paths: ["apps/mcp/", "packages/usecases/src/"],
		walk: "tools/list shows the tool and its schema; tools/call on a sandbox post gives what the CLI's --json gives.",
	},
	{
		id: "provider",
		paths: ["packages/providers/src/"],
		walk: "The command that uses it with --dry-run, then for real against the dead port: it fails with the error and fix it should, and spends nothing.",
	},
	{
		id: "render",
		paths: ["packages/domain/src/", "packages/providers/src/ffmpeg"],
		walk: "beat plan and draft render on a sandbox post; extract a frame per beat and look at each one.",
	},
	{
		id: "schema",
		paths: ["schemas/"],
		walk: "pnpm schemas leaves nothing uncommitted; schema show prints the new field.",
	},
	{
		id: "skill",
		paths: [".agents/skills/"],
		walk: "Every command and flag the skill names exists in --help today.",
	},
];

/** Paths no flow walks: tests, test helpers, generated skills, and settings no user runs. */
export const NO_FLOW: ReadonlyArray<RegExp> = [
	/\.test\.ts$/,
	/\/src\/test\//,
	/^\.agents\/skills\/openspec-/,
	/^packages\/tsconfig\//,
	/(^|\/)(package\.json|tsconfig\.json|vitest(\.integration)?\.config\.ts|README\.md)$/,
];

/** The flows a set of changed paths needs, in the map's order. */
export const flowsFor = (paths: ReadonlyArray<string>): ReadonlyArray<Flow> => {
	const flowPaths = paths.filter((path) => !NO_FLOW.some((pattern) => pattern.test(path)));
	return FLOWS.filter((flow) =>
		flowPaths.some((path) => flow.paths.some((prefix) => path.startsWith(prefix))),
	);
};

const git = (...args: ReadonlyArray<string>): ReadonlyArray<string> =>
	execFileSync("git", args, { encoding: "utf8" }).split("\n").filter(Boolean);

/** Everything the branch changes against base: commits, uncommitted work and new files. */
export const changedPaths = (base: string): ReadonlyArray<string> => [
	...new Set([
		// Three dots diff from the merge base, so commits that landed on base since don't count.
		...git("diff", "--name-only", `${base}...HEAD`),
		...git("diff", "--name-only", "HEAD"),
		...git("ls-files", "--others", "--exclude-standard"),
	]),
];

if (import.meta.main) {
	const base = process.argv[2] ?? "origin/main";
	const flows = flowsFor(changedPaths(base));
	if (flows.length === 0) {
		console.log(`No flow: nothing against ${base} needs one. Write "No flow: <reason>".`);
	} else {
		for (const flow of flows) console.log(`${flow.id}\n  ${flow.walk}\n`);
	}
}
