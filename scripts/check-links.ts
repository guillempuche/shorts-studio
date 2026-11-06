// Fails when a relative link in the docs points at a file that doesn't exist.
//   node scripts/check-links.ts

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const root = join(import.meta.dirname, "..");
const SKIP = new Set([
	"node_modules",
	".git",
	"dist",
	"dist-bin",
	"vendors",
	".corepack",
	"result",
]);
const LINK = /\]\(([^)#\s]+)(?:#[^)]*)?\)/g;

const markdownFiles = (dir: string): Array<string> =>
	readdirSync(dir).flatMap((entry) => {
		if (SKIP.has(entry)) return [];
		const path = join(dir, entry);
		if (statSync(path).isDirectory()) return markdownFiles(path);
		return entry.endsWith(".md") ? [path] : [];
	});

const broken = markdownFiles(root).flatMap((file) =>
	[...readFileSync(file, "utf8").matchAll(LINK)]
		.map((match) => match[1] ?? "")
		.filter((target) => !/^[a-z]+:/i.test(target))
		.filter((target) => !existsSync(join(dirname(file), decodeURIComponent(target))))
		.map((target) => `${relative(root, file)}: ${target}`),
);

if (broken.length > 0) {
	console.error(`Broken links:\n  ${broken.join("\n  ")}`);
	process.exitCode = 1;
} else {
	console.log("All relative links resolve.");
}
