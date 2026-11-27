/**
 * Temporary git repositories for the scripts' tests. Git runs with no global or system config,
 * because the developer's may sign commits and CI has no identity, and without the GIT_*
 * variables a calling git hook exports. Every folder's path holds a space, so the scripts must
 * quote their paths.
 */

import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll } from "vitest";

const made: Array<string> = [];
afterAll(() => {
	for (const folder of made) rmSync(folder, { recursive: true, force: true });
});

/** The environment without GIT_* or SHORTS_* variables, with git's config and identity pinned. */
export const cleanEnv = (extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({
	...Object.fromEntries(
		Object.entries(process.env).filter(
			([name]) => !name.startsWith("GIT_") && !name.startsWith("SHORTS_"),
		),
	),
	GIT_CONFIG_GLOBAL: "/dev/null",
	GIT_CONFIG_NOSYSTEM: "1",
	GIT_AUTHOR_NAME: "Test",
	GIT_AUTHOR_EMAIL: "test@example.com",
	GIT_COMMITTER_NAME: "Test",
	GIT_COMMITTER_EMAIL: "test@example.com",
	...extra,
});

export const git = (cwd: string, ...args: Array<string>): string =>
	execFileSync("git", args, { cwd, env: cleanEnv(), encoding: "utf8" }).trim();

/** A new empty folder under the system's temporary folder, removed after the file's tests. */
export const tempFolder = (): string => {
	// realpath: macOS's temporary folder is a symbolic link, and git reports resolved paths.
	const folder = realpathSync(mkdtempSync(join(tmpdir(), "shorts scripts-")));
	made.push(folder);
	return folder;
};

/** Writes each file under `root`, making its folders; paths ending in `bin/…` are executable. */
export const writeFiles = (root: string, files: Readonly<Record<string, string>>): void => {
	for (const [path, text] of Object.entries(files)) {
		const file = join(root, path);
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, text);
		if (path.startsWith("bin/")) chmodSync(file, 0o755);
	}
};

/** A repository on `main` with one commit holding `files`. */
export const makeRepo = (files: Readonly<Record<string, string>>): string => {
	const root = join(tempFolder(), "repo");
	mkdirSync(root);
	git(root, "init", "-q", "-b", "main");
	writeFiles(root, files);
	git(root, "add", "-A");
	git(root, "commit", "-q", "-m", "start");
	return root;
};

/** A linked worktree of `root` at `path`, on a new branch. */
export const addWorktree = (root: string, path: string, branch: string): string => {
	git(root, "worktree", "add", "-q", "-b", branch, path);
	return path;
};
