import { spawnSync } from "node:child_process";
import { rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { brokenLinks } from "./check-links.ts";
import { addWorktree, makeRepo, tempFolder, writeFiles } from "./test/git.ts";

const DOCS = {
	"README.md": "See [the guide](docs/guide.md).\n",
	"docs/guide.md": "Back to [the README](../README.md).\n",
	".gitignore": "/.sandbox/\n.claude/worktrees/\n",
};

describe("brokenLinks", () => {
	it("should find nothing when every relative link resolves", () => {
		// GIVEN docs whose links all resolve
		const root = makeRepo(DOCS);

		// WHEN the links are checked
		// THEN none is broken
		expect(brokenLinks(root)).toEqual([]);
	});

	it("should name the file and the link of a broken link in a tracked doc", () => {
		// GIVEN a committed doc with a link to a file that doesn't exist
		const root = makeRepo({ ...DOCS, "docs/bad.md": "[gone](missing.md)\n" });

		// WHEN the links are checked
		// THEN that link is reported with its file
		expect(brokenLinks(root)).toEqual(["docs/bad.md: missing.md"]);
	});

	it("should check a new doc before it's committed", () => {
		// GIVEN a doc that isn't tracked yet, nor ignored
		const root = makeRepo(DOCS);
		writeFiles(root, { "docs/new.md": "[gone](missing.md)\n" });

		// WHEN the links are checked
		// THEN its broken link is reported
		expect(brokenLinks(root)).toEqual(["docs/new.md: missing.md"]);
	});

	it("should ignore other worktrees nested in the checkout, and the sandbox's posts", () => {
		// GIVEN a worktree under .claude/worktrees/ and a sandbox post, each with a broken link
		const root = makeRepo(DOCS);
		const lane = addWorktree(root, join(root, ".claude", "worktrees", "lane"), "lane");
		writeFiles(lane, { "README.md": "[gone](missing.md)\n" });
		writeFiles(root, { ".sandbox/posts/p/script.md": "[gone](missing.md)\n" });

		// WHEN the links of the main checkout are checked
		// THEN neither is reported
		expect(brokenLinks(root)).toEqual([]);
	});

	it("should skip a tracked doc removed with rm but not staged", () => {
		// GIVEN a committed doc deleted from the folder only
		const root = makeRepo({ ...DOCS, "docs/old.md": "[the guide](guide.md)\n" });
		rmSync(join(root, "docs/old.md"));

		// WHEN the links are checked
		// THEN the remaining docs are checked without an error
		expect(brokenLinks(root)).toEqual([]);
	});

	it("should read a doc whose name has letters outside ASCII", () => {
		// GIVEN a doc named with an accent and a broken link inside
		const root = makeRepo({ ...DOCS, "docs/guía.md": "[gone](missing.md)\n" });

		// WHEN the links are checked
		// THEN it is found under its own name
		expect(brokenLinks(root)).toEqual(["docs/guía.md: missing.md"]);
	});

	it("should check the docs when started through a symbolic link", () => {
		// GIVEN a link to this repository from another folder
		const link = join(tempFolder(), "repo");
		symlinkSync(join(import.meta.dirname, ".."), link);

		// WHEN the script is started through it
		const run = spawnSync(process.execPath, [join(link, "scripts/check-links.ts")], {
			encoding: "utf8",
		});

		// THEN it reports, rather than ending quietly without checking
		expect(`${run.stdout}${run.stderr}`).toMatch(/All relative links resolve|Broken links/);
	});

	it("should leave vendored docs alone", () => {
		// GIVEN a vendored library's doc with a link that only resolves upstream
		const root = makeRepo({ ...DOCS, "docs/vendors/lib/README.md": "[api](api.md)\n" });

		// WHEN the links are checked
		// THEN it isn't reported
		expect(brokenLinks(root)).toEqual([]);
	});
});
