// Copies the agent skills from .agents/skills/ to .claude/skills/.
//
// Codex and other tools read .agents/skills/, the only folder you edit. Claude Code reads
// .claude/skills/, so that folder holds plain copies, not links: not every tool follows
// links, and links break on Windows checkouts.
//
//   node scripts/skills-sync.ts           replace .claude/skills/ with a fresh copy
//   node scripts/skills-sync.ts --check   change nothing; exit 1 if the copy differs

import { cpSync, existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = join(import.meta.dirname, "..");
const source = join(root, ".agents", "skills");
const copy = join(root, ".claude", "skills");

const filesUnder = (folder: string): string[] =>
	existsSync(folder)
		? readdirSync(folder)
				.filter((entry) => entry !== ".DS_Store")
				.flatMap((entry) => {
					const path = join(folder, entry);
					return statSync(path).isDirectory() ? filesUnder(path) : [path];
				})
		: [];

const differences = (): string[] => {
	const want = new Map(filesUnder(source).map((f) => [relative(source, f), f]));
	const have = new Map(filesUnder(copy).map((f) => [relative(copy, f), f]));
	const out: string[] = [];
	for (const [name, path] of want) {
		const other = have.get(name);
		if (other === undefined) out.push(`missing in .claude/skills: ${name}`);
		else if (!readFileSync(path).equals(readFileSync(other))) out.push(`differs: ${name}`);
	}
	for (const name of have.keys()) {
		if (!want.has(name)) out.push(`only in .claude/skills: ${name}`);
	}
	return out;
};

if (process.argv.includes("--check")) {
	const found = differences();
	if (found.length > 0) {
		console.error(`.claude/skills is out of step with .agents/skills:\n  ${found.join("\n  ")}`);
		console.error("Fix: node scripts/skills-sync.ts");
		process.exitCode = 1;
	}
} else {
	rmSync(copy, { recursive: true, force: true });
	if (existsSync(source)) cpSync(source, copy, { recursive: true });
	console.log("Copied .agents/skills to .claude/skills");
}
