import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { addWorktree, cleanEnv, git, makeRepo, tempFolder, writeFiles } from "./test/git.ts";

const HOOK = join(import.meta.dirname, "worktree-hook.sh");

/** The files of a checkout the hook reads: two open changes, an archived one, the lockfiles. */
const CHECKOUT = {
	"scripts/dev-sandbox.sh": "# the sandbox\n",
	"flake.nix": "{ }\n",
	"flake.lock": "{}\n",
	"pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
	".gitignore": "/node_modules/\n/.sandbox/\n",
	"openspec/changes/brand-look/proposal.md":
		"# Brand look\n\nBuilds on: renderer-text-layers, carousel, old-thing\n\n## Why\n",
	"openspec/changes/brand-look/tasks.md":
		"# Tasks\n\n- [x] 1.1 Done\n- [ X ] 1.2 Done too\n- [ ] 1.3 Not yet\n- [~] 1.4 Not yet either\n",
	"openspec/changes/renderer-text-layers/proposal.md":
		"# Text layers\n\nBuilds on: nothing\n\n## Why\n",
	"openspec/changes/renderer-text-layers/tasks.md": "# Tasks\n\n- [ ] 1.1 A\n",
	"openspec/changes/archive/2026-11-20-old-thing/proposal.md": "# Old\n",
};

/**
 * Programs that stand in for the real ones. `system` is the user's own PATH: Node 24 and a pnpm.
 * `tools` is what the fake Nix's dev shell offers: Node 26, pnpm, ffmpeg and openspec, next to a
 * folder of GNU-like tools that must never reach the agent's PATH. Every call is logged.
 */
const makeFakes = () => {
	const root = tempFolder();
	const log = join(root, "calls.log");
	const system = join(root, "system");
	const tools = join(root, "store", "tools", "bin");
	const gnu = join(root, "store", "gnu", "bin");
	const node = (version: string) => `#!/bin/sh\necho ${version}\n`;
	// Installs by writing pnpm's marker, and logs which Node it ran with.
	const pnpm = `#!/bin/sh
echo "pnpm $* node=$(node --version) in=$PWD" >> "${log}"
[ -n "\${FAKE_PNPM_SLEEP:-}" ] && sleep "$FAKE_PNPM_SLEEP"
[ "\${FAKE_PNPM_FAIL:-}" = 1 ] && { echo "no network" >&2; exit 1; }
mkdir -p node_modules && echo ok > node_modules/.modules.yaml
`;
	const nix = `#!/bin/sh
echo "nix $*" >> "${log}"
printf '{"variables":{"PATH":{"type":"exported","value":"%s"}}}' "${gnu}:${tools}:/usr/bin"
`;
	writeFiles(root, {
		"system/node": node("v24.4.0"),
		"system/pnpm": pnpm,
		"store/tools/bin/node": node("v26.13.0"),
		"store/tools/bin/pnpm": pnpm,
		"store/tools/bin/ffmpeg": "#!/bin/sh\n",
		"store/tools/bin/openspec": "#!/bin/sh\n",
		"store/gnu/bin/sed": "#!/bin/sh\n",
		"store/gnu/bin/xcrun": "#!/bin/sh\n",
		"nix/nix": nix,
	});
	for (const folder of [system, tools, gnu, join(root, "nix")]) {
		for (const program of readdirSync(folder)) chmodSync(join(folder, program), 0o755);
	}
	const calls = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : []);
	return { root, system, tools, gnu, nixDir: join(root, "nix"), calls };
};

type Fakes = ReturnType<typeof makeFakes>;

/** git and jq, without the real Node, so the fakes decide which Node the hook sees. */
const BASE_PATH = [
	dirname(execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim()),
	"/usr/bin",
	"/bin",
].join(":");

interface HookRun {
	readonly mode?: ReadonlyArray<string>;
	readonly input?: Record<string, string> | undefined;
	readonly from: string;
	readonly fakes: Fakes;
	readonly nix?: boolean;
	readonly env?: NodeJS.ProcessEnv;
}

const hookEnv = ({ fakes, nix = true, env = {} }: HookRun): NodeJS.ProcessEnv =>
	cleanEnv({
		PATH: [fakes.system, ...(nix ? [fakes.nixDir] : []), BASE_PATH].join(":"),
		// Where the hook would find Nix when it isn't on PATH: nowhere, in these tests.
		WORKTREE_HOOK_NIX: join(fakes.root, "no-nix-here"),
		// Blank, so mcp-guard looks where the hook runs, never at a project the caller's shell names.
		CLAUDE_PROJECT_DIR: "",
		...env,
	});

const hookArgs = ({ mode = ["session-start", "--json"] }: HookRun) => [HOOK, ...mode];

const runHook = (run: HookRun) => {
	const result = spawnSync("sh", hookArgs(run), {
		cwd: run.from,
		env: hookEnv(run),
		input: run.input === undefined ? "" : JSON.stringify(run.input),
		encoding: "utf8",
	});
	return { status: result.status, stdout: result.stdout, stderr: result.stderr };
};

const runHookInBackground = (run: HookRun) =>
	new Promise<string>((resolve) => {
		const child = spawn("sh", hookArgs(run), { cwd: run.from, env: hookEnv(run) });
		let stdout = "";
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
		});
		child.on("close", () => resolve(stdout));
		child.stdin.end(JSON.stringify(run.input ?? {}));
	});

/** A main checkout with worktrees on the branches the hook has to recognise. */
let main: string;
let lanes: Record<"named" | "desktop" | "other" | "detached" | "old", string>;
let fakes: Fakes;

beforeAll(() => {
	fakes = makeFakes();
	main = makeRepo(CHECKOUT);
	const at = (name: string) => join(main, ".claude", "worktrees", name);
	lanes = {
		named: addWorktree(main, at("brand-look"), "brand-look"),
		desktop: addWorktree(main, at("bright-fox"), "claude/brand-look-x7f2"),
		other: addWorktree(main, at("other"), "feature-zzz"),
		detached: at("detached"),
		old: addWorktree(main, at("old"), "renderer-text-layers"),
	};
	git(main, "worktree", "add", "-q", "--detach", lanes.detached);
	// A branch from before the sandbox existed.
	git(lanes.old, "rm", "-q", "scripts/dev-sandbox.sh");
	git(lanes.old, "commit", "-q", "-m", "before the sandbox");
	// Every lane already has its packages, so the line tests below don't install.
	for (const lane of Object.values(lanes)) {
		writeFiles(lane, { "node_modules/.modules.yaml": "ok\n" });
	}
});

/** A fresh main checkout and worktree, for tests that install or write caches. */
const freshLane = (branch = "brand-look") => {
	const repo = makeRepo(CHECKOUT);
	const lane = addWorktree(repo, join(repo, ".claude", "worktrees", branch), branch);
	return { repo, lane, fakes: makeFakes() };
};

/** Node 26 first on PATH, so the hook asks Nix for nothing. */
const nodeIs26 = (f: Fakes) => ({ PATH: [f.tools, f.system, f.nixDir, BASE_PATH].join(":") });

describe("worktree-hook.sh session-start: what it says", () => {
	it("should print nothing outside a git checkout", () => {
		// GIVEN a folder that isn't a git checkout
		const loose = tempFolder();

		// WHEN a session opens there
		const run = runHook({ from: loose, input: { cwd: loose, source: "startup" }, fakes });

		// THEN the hook is silent and succeeds
		expect(run.status).toBe(0);
		expect(run.stdout).toBe("");
	});

	it("should tell a main checkout session that it works on real posts", () => {
		// GIVEN the main checkout
		// WHEN a session opens there
		const run = runHook({
			from: main,
			input: { cwd: main, source: "startup" },
			fakes,
			env: nodeIs26(fakes),
		});

		// THEN the first line says so and points to worktrees
		const first = run.stdout.split("\n")[0];
		expect(first).toContain("main checkout");
		expect(first).toContain("real posts");
		expect(run.stdout).toContain("docs/worktrees.md");
		expect(run.status).toBe(0);
	});

	it("should name the sandbox, the change, its tasks and what it builds on", () => {
		// GIVEN a worktree on a branch named after an open change
		// WHEN a session opens there
		const run = runHook({
			from: lanes.named,
			input: { cwd: lanes.named, source: "startup" },
			fakes,
			env: nodeIs26(fakes),
		});

		// THEN the first line names the sandbox and the refused MCP tools
		const [first, ...rest] = run.stdout.trim().split("\n");
		expect(first).toContain("worktree");
		expect(first).toContain(".sandbox");
		expect(first).toContain("MCP tools are refused");
		// AND another line gives the change, its tasks done (only a box holding x counts), and the
		// status of each change it builds on
		const change = rest.join("\n");
		expect(change).toContain("brand-look");
		expect(change).toContain("2/4 tasks done");
		expect(change).toContain("renderer-text-layers (open)");
		expect(change).toContain("carousel (unknown)");
		expect(change).toContain("old-thing (archived)");
	});

	it("should find the change in a desktop session's branch", () => {
		// GIVEN a worktree on claude/<change>-<suffix>, as the desktop app names them
		// WHEN a session opens there
		const run = runHook({
			from: lanes.desktop,
			input: { cwd: lanes.desktop, source: "startup" },
			fakes,
			env: nodeIs26(fakes),
		});

		// THEN the change is found
		expect(run.stdout).toContain("OpenSpec change brand-look");
	});

	it("should say when the branch matches no open change", () => {
		// GIVEN a worktree whose branch names no change
		// WHEN a session opens there
		const run = runHook({
			from: lanes.other,
			input: { cwd: lanes.other, source: "startup" },
			fakes,
			env: nodeIs26(fakes),
		});

		// THEN the line says so, naming the branch
		expect(run.stdout).toContain("feature-zzz matches no open OpenSpec change");
		expect(run.status).toBe(0);
	});

	it("should give the command to start a branch on a detached HEAD", () => {
		// GIVEN a worktree on a detached HEAD
		// WHEN a session opens there
		const run = runHook({
			from: lanes.detached,
			input: { cwd: lanes.detached, source: "startup" },
			fakes,
			env: nodeIs26(fakes),
		});

		// THEN it says so and gives the command
		expect(run.stdout).toContain("detached HEAD");
		expect(run.stdout).toContain("git switch -c <change>");
	});

	it("should warn first when the branch predates the sandbox", () => {
		// GIVEN a worktree whose branch has no scripts/dev-sandbox.sh
		// WHEN a session opens there
		const run = runHook({
			from: lanes.old,
			input: { cwd: lanes.old, source: "startup" },
			fakes,
			env: nodeIs26(fakes),
		});

		// THEN the first line says its bin uses real posts until it's rebased
		const first = run.stdout.split("\n")[0];
		expect(first).toContain("predates the sandbox");
		expect(first).toContain("real posts");
		expect(first).toContain("rebase");
		expect(run.stdout).not.toContain(".sandbox/");
	});

	it("should not claim the MCP tools are refused in a Codex session", () => {
		// GIVEN a worktree, and the hook run as Codex runs it
		// WHEN a session opens there
		const run = runHook({
			mode: ["session-start", "--json", "--codex"],
			from: lanes.named,
			input: { cwd: lanes.named, source: "startup" },
			fakes,
			env: nodeIs26(fakes),
		});

		// THEN the line says to check doctor's data folder instead
		expect(run.stdout).not.toContain("refused");
		expect(run.stdout).toContain("doctor");
	});

	it("should read the worktree from the input when the hook runs in the main checkout", () => {
		// GIVEN a desktop worktree session, whose hooks run in the main checkout
		// WHEN a session opens with its cwd in the worktree
		const run = runHook({
			from: main,
			input: { cwd: lanes.named, source: "startup" },
			fakes,
			env: nodeIs26(fakes),
		});

		// THEN the worktree's line is printed
		expect(run.stdout.split("\n")[0]).toContain(".sandbox");
	});

	it("should run without reading standard input when not given --json, as Codex's setup runs it", () => {
		// GIVEN a worktree, and no JSON on standard input
		// WHEN Codex's setup runs the hook from inside the worktree
		const run = runHook({
			mode: ["session-start", "--codex"],
			from: lanes.named,
			input: undefined,
			fakes,
			env: nodeIs26(fakes),
		});

		// THEN it describes the worktree it runs in
		expect(run.stdout).toContain("OpenSpec change brand-look");
		expect(run.status).toBe(0);
	});
});

describe("worktree-hook.sh session-start: packages and tools", () => {
	it("should install a new worktree's packages with the Nix shell's Node", () => {
		// GIVEN a new worktree, Node 24 on PATH and Nix installed, as in a Codex session
		const { lane, fakes: f } = freshLane();

		// WHEN a session opens there
		const run = runHook({ from: lane, input: { cwd: lane, source: "startup" }, fakes: f });

		// THEN pnpm installed once, with the frozen lockfile, on Node 26, in the worktree
		const installs = f.calls().filter((call) => call.startsWith("pnpm"));
		expect(installs).toEqual([`pnpm install --frozen-lockfile node=v26.13.0 in=${lane}`]);
		expect(run.status).toBe(0);
	});

	it("should not install again until the lockfile changes", () => {
		// GIVEN a worktree whose packages the hook installed
		const { lane, fakes: f } = freshLane();
		const open = () => runHook({ from: lane, input: { cwd: lane, source: "resume" }, fakes: f });
		open();

		// WHEN a session opens again, then again after the lockfile changed
		open();
		const before = f.calls().filter((call) => call.startsWith("pnpm")).length;
		writeFileSync(join(lane, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n# a new package\n");
		open();

		// THEN only the lockfile's change installed again
		expect(before).toBe(1);
		expect(f.calls().filter((call) => call.startsWith("pnpm"))).toHaveLength(2);
	});

	it("should install once when two sessions open together", async () => {
		// GIVEN a new worktree and a slow install
		const { lane, fakes: f } = freshLane();
		const run: HookRun = {
			from: lane,
			input: { cwd: lane, source: "startup" },
			fakes: f,
			env: { FAKE_PNPM_SLEEP: "1" },
		};

		// WHEN two sessions open at the same moment
		await Promise.all([runHookInBackground(run), runHookInBackground(run)]);

		// THEN pnpm ran once
		expect(f.calls().filter((call) => call.startsWith("pnpm"))).toHaveLength(1);
	});

	it("should take over a lock left by a session that's gone", () => {
		// GIVEN a lock held by a process that no longer runs
		const { lane, fakes: f } = freshLane();
		const lock = join(git(lane, "rev-parse", "--absolute-git-dir"), "shorts-session.lock");
		mkdirSync(lock);
		const gone = spawnSync("sh", ["-c", "echo $$"], { encoding: "utf8" }).stdout.trim();
		writeFileSync(join(lock, "pid"), `${gone}\n`);

		// WHEN a session opens
		runHook({ from: lane, input: { cwd: lane, source: "startup" }, fakes: f });

		// THEN it installed anyway, and gave the lock back
		expect(f.calls().filter((call) => call.startsWith("pnpm"))).toHaveLength(1);
		expect(existsSync(lock)).toBe(false);
	});

	it("should name the log when the install fails, and still let the session open", () => {
		// GIVEN an install that fails
		const { lane, fakes: f } = freshLane();

		// WHEN a session opens
		const run = runHook({
			from: lane,
			input: { cwd: lane, source: "startup" },
			fakes: f,
			env: { FAKE_PNPM_FAIL: "1" },
		});

		// THEN the hook succeeds, and names the log holding the reason
		expect(run.status).toBe(0);
		const log = /see (.+shorts-worktree-install\.log)/.exec(run.stdout)?.[1];
		expect(log).toBeDefined();
		expect(readFileSync(log ?? "", "utf8")).toContain("no network");
	});

	it("should say how to install when there's neither Node 26 nor Nix", () => {
		// GIVEN a new worktree, Node 24 and no Nix
		const { lane, fakes: f } = freshLane();

		// WHEN a session opens
		const run = runHook({
			from: lane,
			input: { cwd: lane, source: "startup" },
			fakes: f,
			nix: false,
		});

		// THEN nothing was installed, and the line says how, without a Nix command it can't run
		expect(f.calls().filter((call) => call.startsWith("pnpm"))).toEqual([]);
		expect(run.stdout).toContain("Install Nix");
		expect(run.stdout).not.toContain("nix develop");
		expect(run.status).toBe(0);
	});

	it("should give Claude's shell only the four tools' folders, once", () => {
		// GIVEN a Claude Code session's environment file
		const { lane, fakes: f } = freshLane();
		const envFile = join(f.root, "claude-env");
		writeFileSync(envFile, "");
		const open = () =>
			runHook({
				from: lane,
				input: { cwd: lane, source: "startup" },
				fakes: f,
				env: { CLAUDE_ENV_FILE: envFile },
			});

		// WHEN the session opens, then resumes
		open();
		open();

		// THEN the file holds one line putting the tools' folder first, and nothing else from Nix
		expect(readFileSync(envFile, "utf8")).toBe(`export PATH="${f.tools}:$PATH"\n`);
	});

	it("should share the toolchain between worktrees, and work it out again when the flake changes", () => {
		// GIVEN two worktrees of one repository
		const { repo, lane, fakes: f } = freshLane();
		const second = addWorktree(repo, join(repo, ".claude", "worktrees", "second"), "second");
		const nixCalls = () => f.calls().filter((call) => call.startsWith("nix")).length;

		// WHEN sessions open in both, then in one after its flake.lock changed
		runHook({ from: lane, input: { cwd: lane, source: "startup" }, fakes: f });
		runHook({ from: second, input: { cwd: second, source: "startup" }, fakes: f });
		const afterTwo = nixCalls();
		writeFileSync(join(second, "flake.lock"), '{"changed":true}\n');
		runHook({ from: second, input: { cwd: second, source: "startup" }, fakes: f });

		// THEN Nix was asked once for both, and again after the change
		expect(afterTwo).toBe(1);
		expect(nixCalls()).toBe(2);
	});

	it("should work the toolchain out again when a cached folder is gone", () => {
		// GIVEN a cached toolchain whose folder was garbage-collected
		const { lane, fakes: f } = freshLane();
		runHook({ from: lane, input: { cwd: lane, source: "startup" }, fakes: f });
		const cache = join(
			git(lane, "rev-parse", "--path-format=absolute", "--git-common-dir"),
			"shorts-devshell-path",
		);
		writeFileSync(cache, readFileSync(cache, "utf8").replace(f.tools, join(f.root, "gone")));

		// WHEN a session opens again
		runHook({ from: lane, input: { cwd: lane, source: "resume" }, fakes: f });

		// THEN Nix was asked again
		expect(f.calls().filter((call) => call.startsWith("nix"))).toHaveLength(2);
	});

	it("should leave PATH alone when Node 26 is already first", () => {
		// GIVEN Node 26 first on PATH and a Claude Code environment file
		const { lane, fakes: f } = freshLane();
		const envFile = join(f.root, "claude-env");
		writeFileSync(envFile, "");

		// WHEN a session opens
		runHook({
			from: lane,
			input: { cwd: lane, source: "startup" },
			fakes: f,
			env: { ...nodeIs26(f), CLAUDE_ENV_FILE: envFile },
		});

		// THEN Nix wasn't asked and nothing was written
		expect(f.calls().filter((call) => call.startsWith("nix"))).toEqual([]);
		expect(readFileSync(envFile, "utf8")).toBe("");
	});

	it("should find Nix at its default profile when PATH doesn't have it", () => {
		// GIVEN Nix only at the default profile's path, as in a GUI app's hook
		const { lane, fakes: f } = freshLane();

		// WHEN a session opens
		runHook({
			from: lane,
			input: { cwd: lane, source: "startup" },
			fakes: f,
			nix: false,
			env: { WORKTREE_HOOK_NIX: join(f.nixDir, "nix") },
		});

		// THEN the install ran on the Nix shell's Node
		expect(f.calls().filter((call) => call.startsWith("pnpm"))).toEqual([
			`pnpm install --frozen-lockfile node=v26.13.0 in=${lane}`,
		]);
	});

	it("should print the line again after compaction, without installing or asking Nix", () => {
		// GIVEN a new worktree
		const { lane, fakes: f } = freshLane();

		// WHEN its session's context is compacted
		const run = runHook({ from: lane, input: { cwd: lane, source: "compact" }, fakes: f });

		// THEN the line is back and nothing ran
		expect(run.stdout).toContain(".sandbox");
		expect(f.calls()).toEqual([]);
	});
});

describe("worktree-hook.sh mcp-guard", () => {
	const guard = (from: string, input: Record<string, string>, env: NodeJS.ProcessEnv = {}) =>
		runHook({ mode: ["mcp-guard"], from, input, fakes, env: { CLAUDE_PROJECT_DIR: main, ...env } });

	it("should refuse a tool call from a worktree session, naming bin/shorts-studio", () => {
		// GIVEN a session working in a worktree
		// WHEN it calls a shorts-studio MCP tool
		const run = guard(main, {
			cwd: lanes.named,
			session_id: "s-1",
			tool_name: "mcp__shorts-studio__post_list",
		});

		// THEN the hook answers with a deny and a reason
		const answer = JSON.parse(run.stdout);
		expect(answer.hookSpecificOutput).toMatchObject({
			hookEventName: "PreToolUse",
			permissionDecision: "deny",
		});
		expect(answer.hookSpecificOutput.permissionDecisionReason).toContain("bin/shorts-studio");
		expect(run.status).toBe(0);
	});

	it("should refuse a worktree session that moved outside git", () => {
		// GIVEN a session that opened in a worktree, then moved to a scratch folder
		runHook({
			from: main,
			input: { cwd: lanes.named, source: "startup", session_id: "moved-1" },
			fakes,
			env: nodeIs26(fakes),
		});
		const scratch = tempFolder();

		// WHEN it calls a shorts-studio MCP tool from there
		const run = guard(main, { cwd: scratch, session_id: "moved-1" });

		// THEN the call is refused
		expect(JSON.parse(run.stdout).hookSpecificOutput.permissionDecision).toBe("deny");
	});

	it("should let a main checkout session call the tools", () => {
		// GIVEN a session working in the main checkout
		// WHEN it calls a shorts-studio MCP tool
		const run = guard(main, { cwd: main, session_id: "main-1" });

		// THEN the hook says nothing, so the call runs
		expect(run.stdout).toBe("");
		expect(run.status).toBe(0);
	});

	it("should let a worktree session that came back to the main checkout call the tools", () => {
		// GIVEN a session that opened in a worktree, then returned to the main checkout
		runHook({
			from: main,
			input: { cwd: lanes.named, source: "startup", session_id: "back-1" },
			fakes,
			env: nodeIs26(fakes),
		});

		// WHEN it calls a shorts-studio MCP tool from the main checkout
		const run = guard(main, { cwd: main, session_id: "back-1" });

		// THEN the call runs: the main checkout's code is what it works on now
		expect(run.stdout).toBe("");
	});

	it("should let the call run when the input has no cwd and the session is unknown", () => {
		// GIVEN input without a cwd, from a session never seen
		// WHEN the guard runs
		const run = guard(main, { session_id: "unknown-1" });

		// THEN it allows, so daily use never breaks
		expect(run.stdout).toBe("");
	});

	it("should ignore a session id that could name another file", () => {
		// GIVEN a session id with a path in it
		// WHEN a worktree session opens with it, then calls a tool from the main checkout
		runHook({
			from: main,
			input: { cwd: lanes.named, source: "startup", session_id: "../../x" },
			fakes,
			env: nodeIs26(fakes),
		});
		const run = guard(main, { cwd: main, session_id: "../../x" });

		// THEN nothing was recorded for it, and the main checkout's call runs
		expect(run.stdout).toBe("");
		expect(existsSync(join(main, ".git", "x"))).toBe(false);
	});
});

describe("worktree-hook.sh usage", () => {
	it("should refuse an unknown mode", () => {
		// GIVEN a mode the hook doesn't have
		// WHEN it runs
		const run = runHook({ mode: ["sideways"], from: main, fakes });

		// THEN it exits 2 with its usage
		expect(run.status).toBe(2);
		expect(run.stderr).toContain("session-start");
	});
});
