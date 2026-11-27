import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { addWorktree, cleanEnv, makeRepo, tempFolder, writeFiles } from "./test/git.ts";

const ROOT = join(import.meta.dirname, "..");

/** Stands in for the CLI: prints the environment the sandbox decides, as one JSON line. */
const STUB_CLI = `
const env = process.env;
console.log(JSON.stringify({
	data: env.SHORTS_DATA_DIR ?? null,
	posts: env.SHORTS_POSTS_DIR ?? null,
	user: env.USER ?? null,
	urls: Object.fromEntries(Object.entries(env).filter(([name]) => /^SHORTS_.*_URL$/.test(name))),
	keys: { alpha: env.ALPHA_KEY ?? null, beta: env.BETA_API_KEY ?? null, tests: env.TEST_ONLY_KEY ?? null },
	args: process.argv.slice(2),
}));
`;

/** A checkout with the real `bin/shorts-studio` and sandbox, two providers and the stub CLI. */
const checkoutFiles = (): Record<string, string> => ({
	"bin/shorts-studio": readFileSync(join(ROOT, "bin/shorts-studio"), "utf8"),
	"scripts/dev-sandbox.sh": readFileSync(join(ROOT, "scripts/dev-sandbox.sh"), "utf8"),
	"apps/cli/src/main.ts": STUB_CLI,
	".gitignore": "/.sandbox/\n",
	"packages/providers/src/alpha.ts": [
		'export const ALPHA_KEY: KeySpec = { env: "ALPHA_KEY", keychain: "alpha-key" };',
		'const ALPHA: PaidService = { id: "alpha", name: "Alpha", key: ALPHA_KEY };',
	].join("\n"),
	"packages/providers/src/beta-two.ts": [
		'export const BETA_KEY: KeySpec = { env: "BETA_API_KEY", keychain: "beta-api-key" };',
		'const BETA: PaidService = { id: "beta-two", name: "Beta Two", key: BETA_KEY };',
	].join("\n"),
	// A test's fake provider: not one the CLI can call, so the sandbox leaves it alone.
	"packages/providers/src/alpha.test.ts": [
		'const KEY: KeySpec = { env: "TEST_ONLY_KEY", keychain: "test-only" };',
		'const ONLY: PaidService = { id: "only-in-tests", name: "Only", key: KEY };',
	].join("\n"),
});

/** A main checkout and a linked worktree of it, where Claude Code puts its worktrees. */
const repoWithWorktree = () => {
	const main = makeRepo(checkoutFiles());
	const worktree = addWorktree(main, join(main, ".claude", "worktrees", "lane"), "lane");
	return { main, worktree };
};

/** The user's environment: their own name, Node on PATH, nothing set for shorts-studio. */
const userEnv = (extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv =>
	cleanEnv({
		USER: "someone",
		PATH: `${dirname(process.execPath)}:${process.env["PATH"]}`,
		...extra,
	});

const runBin = (bin: string, env: NodeJS.ProcessEnv = {}) => {
	const result = spawnSync(bin, ["post", "list", "--json"], {
		env: userEnv(env),
		encoding: "utf8",
	});
	return {
		status: result.status,
		stdout: result.stdout,
		stderr: result.stderr,
		seen: () => JSON.parse(result.stdout),
	};
};

describe("bin/shorts-studio in a worktree", () => {
	it("should keep a worktree's posts and data in its .sandbox folder", () => {
		// GIVEN a linked worktree and nothing set for shorts-studio
		const { worktree } = repoWithWorktree();

		// WHEN its bin runs
		const run = runBin(join(worktree, "bin/shorts-studio"));

		// THEN the CLI gets folders inside the worktree's .sandbox, which exist
		expect(run.seen()).toMatchObject({
			data: join(worktree, ".sandbox", "data"),
			posts: join(worktree, ".sandbox", "posts"),
		});
		expect(readdirSync(join(worktree, ".sandbox")).sort()).toEqual(["data", "posts"]);
		// AND the CLI's own arguments pass through unchanged
		expect(run.seen().args).toEqual(["post", "list", "--json"]);
	});

	it("should replace the folders the user's environment sets", () => {
		// GIVEN the user's shell exports their real folders
		const { worktree } = repoWithWorktree();

		// WHEN a worktree's bin runs
		const run = runBin(join(worktree, "bin/shorts-studio"), {
			SHORTS_DATA_DIR: "/real/data",
			SHORTS_POSTS_DIR: "/real/posts",
		});

		// THEN the sandbox's folders win
		expect(run.seen()).toMatchObject({
			data: join(worktree, ".sandbox", "data"),
			posts: join(worktree, ".sandbox", "posts"),
		});
	});

	it("should use the folder SHORTS_SANDBOX_DIR names, as the verify skill sets it", () => {
		// GIVEN a scratch folder chosen by the verify skill
		const { worktree } = repoWithWorktree();
		const scratch = join(tempFolder(), "verify run");

		// WHEN a worktree's bin runs with it
		const run = runBin(join(worktree, "bin/shorts-studio"), { SHORTS_SANDBOX_DIR: scratch });

		// THEN posts and data live there
		expect(run.seen()).toMatchObject({
			data: join(scratch, "data"),
			posts: join(scratch, "posts"),
		});
	});

	it("should refuse a SHORTS_SANDBOX_DIR that isn't an absolute path", () => {
		// GIVEN a relative sandbox folder
		const { worktree } = repoWithWorktree();

		// WHEN a worktree's bin runs with it
		const run = runBin(join(worktree, "bin/shorts-studio"), { SHORTS_SANDBOX_DIR: "tmp/x" });

		// THEN it stops before the CLI starts, saying why
		expect(run.status).toBe(2);
		expect(run.stdout).toBe("");
		expect(run.stderr).toContain("SHORTS_SANDBOX_DIR");
		expect(run.stderr).toContain("absolute");
	});

	it("should send every paid provider to the dead port with a fake key, and hide the Keychain", () => {
		// GIVEN two providers in the code, and a test-only one
		const { worktree } = repoWithWorktree();

		// WHEN a worktree's bin runs
		const seen = runBin(join(worktree, "bin/shorts-studio")).seen();

		// THEN both providers point at a port that refuses connections
		expect(seen.urls).toEqual({
			SHORTS_ALPHA_URL: "http://127.0.0.1:9",
			SHORTS_BETA_TWO_URL: "http://127.0.0.1:9",
		});
		// AND their keys are fake but not empty, so nothing falls back to the Keychain
		expect(seen.keys.alpha).toMatch(/^fake/);
		expect(seen.keys.beta).toMatch(/^fake/);
		// AND the test-only provider is left alone
		expect(seen.keys.tests).toBeNull();
		// AND Keychain lookups ask for an account that doesn't exist
		expect(seen.user).toBe("shorts-sandbox");
	});

	it("should print nothing on standard output besides the command's own", () => {
		// GIVEN a linked worktree
		const { worktree } = repoWithWorktree();

		// WHEN its bin runs a command with JSON output
		const run = runBin(join(worktree, "bin/shorts-studio"));

		// THEN standard output is exactly the command's one JSON line
		expect(run.stdout.trimEnd().split("\n")).toHaveLength(1);
		expect(() => JSON.parse(run.stdout)).not.toThrow();
		expect(run.stderr).toBe("");
	});

	it("should still use the sandbox when git's hook variables point at the main checkout", () => {
		// GIVEN GIT_DIR and GIT_WORK_TREE as git exports them to a hook in the main checkout
		const { main, worktree } = repoWithWorktree();

		// WHEN a worktree's bin runs from such a hook
		const run = runBin(join(worktree, "bin/shorts-studio"), {
			GIT_DIR: join(main, ".git"),
			GIT_WORK_TREE: main,
		});

		// THEN it still knows it's a worktree
		expect(run.seen().data).toBe(join(worktree, ".sandbox", "data"));
	});

	it("should decide from where bin really is, when it's reached through a symbolic link", () => {
		// GIVEN a link to a worktree's bin from a folder outside any checkout
		const { worktree } = repoWithWorktree();
		const link = join(tempFolder(), "shorts-studio");
		symlinkSync(join(worktree, "bin/shorts-studio"), link);

		// WHEN the link runs
		const run = runBin(link);

		// THEN it uses that worktree's sandbox
		expect(run.seen().data).toBe(join(worktree, ".sandbox", "data"));
	});
});

describe("bin/shorts-studio elsewhere", () => {
	it("should leave the main checkout on the user's own folders and keys", () => {
		// GIVEN the main checkout and the user's real folders in the environment
		const { main } = repoWithWorktree();

		// WHEN its bin runs
		const seen = runBin(join(main, "bin/shorts-studio"), { SHORTS_DATA_DIR: "/real/data" }).seen();

		// THEN nothing is changed
		expect(seen).toMatchObject({ data: "/real/data", posts: null, user: "someone", urls: {} });
		expect(seen.keys.alpha).toBeNull();
	});

	it("should leave a copy outside git on the user's own folders", () => {
		// GIVEN the same files in a folder that isn't a git checkout
		const loose = join(tempFolder(), "loose");
		mkdirSync(loose);
		writeFiles(loose, checkoutFiles());

		// WHEN its bin runs
		const seen = runBin(join(loose, "bin/shorts-studio")).seen();

		// THEN nothing is changed
		expect(seen).toMatchObject({ data: null, user: "someone", urls: {} });
	});

	it("should turn the sandbox off in a worktree with SHORTS_SANDBOX=0", () => {
		// GIVEN a worktree, with the sandbox switched off
		const { worktree } = repoWithWorktree();

		// WHEN its bin runs
		const seen = runBin(join(worktree, "bin/shorts-studio"), {
			SHORTS_SANDBOX: "0",
			SHORTS_DATA_DIR: "/real/data",
		}).seen();

		// THEN the user's own folder is used
		expect(seen).toMatchObject({ data: "/real/data", user: "someone", urls: {} });
	});

	it("should turn the sandbox on in the main checkout with SHORTS_SANDBOX=1", () => {
		// GIVEN the main checkout, with the sandbox switched on
		const { main } = repoWithWorktree();

		// WHEN its bin runs
		const seen = runBin(join(main, "bin/shorts-studio"), { SHORTS_SANDBOX: "1" }).seen();

		// THEN it uses the main checkout's own .sandbox
		expect(seen).toMatchObject({ data: join(main, ".sandbox", "data"), user: "shorts-sandbox" });
	});

	it("should refuse a SHORTS_SANDBOX that is neither 0 nor 1", () => {
		// GIVEN a value that could be read either way
		const { worktree } = repoWithWorktree();

		// WHEN a worktree's bin runs with it
		const run = runBin(join(worktree, "bin/shorts-studio"), { SHORTS_SANDBOX: "yes" });

		// THEN it stops before the CLI starts, naming the values it takes
		expect(run.status).toBe(2);
		expect(run.stdout).toBe("");
		expect(run.stderr).toContain("SHORTS_SANDBOX");
	});
});

describe("the sandbox's view of the real providers", () => {
	it("should find every paid service and key the providers declare", () => {
		// GIVEN the repository's real provider files, read as the sandbox reads them
		const providers = join(ROOT, "packages/providers/src");
		const sources = readdirSync(providers)
			.filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
			.map((file) => readFileSync(join(providers, file), "utf8"))
			.join("\n");
		const declared = (pattern: RegExp) => (sources.match(pattern) ?? []).length;

		// WHEN the real sandbox is set up for this repository
		const scratch = join(tempFolder(), "guard");
		const result = spawnSync(
			"sh",
			["-c", 'checkout="$1"; . "$1/scripts/dev-sandbox.sh" && env', "sh", ROOT],
			{ env: userEnv({ SHORTS_SANDBOX: "1", SHORTS_SANDBOX_DIR: scratch }), encoding: "utf8" },
		);
		const lines = result.stdout.split("\n");

		// THEN it pointed one address per PaidService declaration at the dead port.
		// (A declaration it can't read, such as one wrapped over several lines, would escape.)
		const urls = lines.filter((line) =>
			/^SHORTS_[A-Z0-9_]+_URL=http:\/\/127\.0\.0\.1:9$/.test(line),
		);
		expect(urls.length).toBe(declared(/: PaidService =/g));
		// AND gave one fake key per KeySpec declaration
		const fakeKeys = lines.filter((line) => /^[A-Z0-9_]+=fake-sandbox-key$/.test(line));
		expect(fakeKeys.length).toBe(declared(/: KeySpec =/g));
		expect(urls.length).toBeGreaterThan(0);
	});
});
