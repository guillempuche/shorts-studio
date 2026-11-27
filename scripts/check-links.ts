// Fails when a relative link in the docs points at a file that doesn't exist.
//   node scripts/check-links.ts
//
// The docs are the Markdown files git knows, tracked or new, so whatever .gitignore leaves out
// (other worktrees under .claude/worktrees/, a worktree's .sandbox/ posts, node_modules) is never
// read. Vendored libraries' docs are skipped: their links resolve upstream.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const SKIPPED_FOLDERS = new Set(["vendors"]);
// `[text](target#anchor)`: the first group is the target, without its anchor.
const LINK = /\]\(([^)#\s]+)(?:#[^)]*)?\)/g;

/** Markdown files under `root` that git tracks or would track, as paths relative to it. */
const markdownFiles = (root: string): Array<string> =>
	execFileSync(
		"git",
		// -z, because otherwise git quotes a name with letters outside ASCII.
		["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", "*.md"],
		{ cwd: root, encoding: "utf8" },
	)
		.split("\0")
		.filter((path) => path !== "")
		.filter((path) => !path.split("/").some((part) => SKIPPED_FOLDERS.has(part)))
		// A doc deleted from the folder stays in git's list until the deletion is staged.
		.filter((path) => existsSync(join(root, path)));

/** Each relative link that points nowhere, as `file: target`. */
export const brokenLinks = (root: string): Array<string> =>
	markdownFiles(root).flatMap((file) =>
		[...readFileSync(join(root, file), "utf8").matchAll(LINK)]
			.map((match) => match[1] ?? "")
			.filter((target) => !/^[a-z]+:/i.test(target))
			// Decoded because a link writes a space in a file name as %20.
			.filter((target) => !existsSync(join(root, dirname(file), decodeURIComponent(target))))
			.map((target) => `${file}: ${target}`),
	);

// import.meta.main, not a comparison with process.argv[1]: started through a symbolic link, the
// two paths differ and the check would pass without checking anything.
if (import.meta.main) {
	const broken = brokenLinks(join(import.meta.dirname, ".."));
	if (broken.length > 0) {
		console.error(`Broken links:\n  ${broken.join("\n  ")}`);
		process.exitCode = 1;
	} else {
		console.log("All relative links resolve.");
	}
}
