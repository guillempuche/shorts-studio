# Tasks

## 0. Before starting

- [x] 0.1 The verify skill's in-progress work (untracked `.agents/skills/verify/`, `.claude/skills/verify/`, the AGENTS.md line, the ten `tasks.md` lines) is committed and pushed by whoever owns it; verify: `git status --short` on main shows none of those paths, and `git log origin/main -1 -- .agents/skills/verify` prints a commit
- [x] 0.2 Open a worktree on branch `parallel-worktrees` from `origin/main`; verify: `git -C <worktree> rev-parse --abbrev-ref HEAD` prints `parallel-worktrees`, and `nix develop -c pnpm install --frozen-lockfile` passes there

## 1. Sandbox in worktrees

- [x] 1.1 Write a shared test helper in `scripts/test/` that makes temporary git repositories, one of them with a space in its path. It runs git with `GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_NOSYSTEM=1`, an explicit `GIT_AUTHOR_*`/`GIT_COMMITTER_*` and no inherited `GIT_*`, because the developer's config signs commits with SSH and CI has no identity. Verify: a commit made through it succeeds with `commit.gpgsign=true` in the global config
- [x] 1.2 Write the failing tests first (`scripts/dev-sandbox.test.ts`, test-bdd style) on a temporary repository with a linked worktree, a copy of `bin/shorts-studio` and `scripts/dev-sandbox.sh`, two fake providers, and a stub `apps/cli/src/main.ts` that prints its environment as JSON. Cases:
  - worktree default;
  - the user's `SHORTS_DATA_DIR` replaced;
  - `SHORTS_SANDBOX_DIR` honoured, and a relative one refused with exit 2;
  - `SHORTS_SANDBOX=0` and `=1`;
  - main checkout untouched; outside git untouched;
  - a bin reached through a symlink;
  - an inherited `GIT_DIR` pointing at the main checkout;
  - every provider's URL and key covered, and `USER=shorts-sandbox`;
  - nothing on standard output but the stub's JSON.

  Plus the guard test on the real `packages/providers/src`: the discovery finds as many ids and key names as there are `: PaidService =` and `: KeySpec =` declarations. Verify: they fail for the missing behaviour
- [x] 1.3 Add a `scripts` vitest project and a root `test:scripts` task that `pnpm test` runs (`turbo run test test:scripts`, `//#test:scripts` in turbo.json); verify: `pnpm test` runs the new files, and CI's `pnpm test` step would run them
- [x] 1.4 `scripts/dev-sandbox.sh`, sourced and printing nothing, from the verify skill's provider and key discovery; `bin/shorts-studio` sources it by the rule in design decision 1; verify: 1.2 passes
- [x] 1.5 `SHORTS_SANDBOX` and `SHORTS_SANDBOX_DIR` in `NOT_SETTINGS` (`packages/providers/src/node.ts`), with a test that `doctor`'s issues name neither, and a test with a fake `security` first on `PATH` that a key lookup with `USER=shorts-sandbox` asks for that account and finds nothing; verify: both pass, and `SHORTS_SANDBOX=1 bin/shorts-studio doctor` in a scratch sandbox reports no blocking "not a setting" problem (it does today)
- [x] 1.6 `pnpm cli` runs `bin/shorts-studio`; `/.sandbox/` in `.gitignore`; verify: `pnpm cli config show --json` in a worktree reports data and posts under `.sandbox/`, and `git check-ignore .sandbox/x` succeeds
- [x] 1.7 The verify skill's `sandbox.sh` keeps its `mktemp` folder, exports `SHORTS_SANDBOX=1` and `SHORTS_SANDBOX_DIR="$SANDBOX"`, sources `scripts/dev-sandbox.sh` and keeps its own messages. It writes the `mcp serve` it starts to `$SANDBOX/mcp.pid` and stops only that process. Its `pkill` line goes. Then `pnpm skills:sync`. Verify: sourcing it in a worktree prints the same messages as before, and after cleanup the started server is gone while the session's own servers (`pgrep -fl "mcp serve"`) remain

## 2. Session start and the MCP guard

- [x] 2.1 Write the failing tests first (`scripts/worktree-hook.test.ts`) on temporary repositories from the 1.1 helper. Fake `pnpm`, `node`, `nix` and `security` programs go first on `PATH`; the fake `nix` answers `print-dev-env --json` with a `PATH` of temporary folders, some holding `node`, `pnpm`, `ffmpeg` and `openspec`, others holding `sed` and `xcrun`.
  - `session-start`, where and what it says:
    - no output outside git;
    - the main checkout line;
    - the worktree line with change, tasks done and `Builds on:` statuses;
    - a `claude/<change>-<suffix>` branch matched; no matching change; a detached HEAD;
    - a worktree with no `scripts/dev-sandbox.sh` getting the "predates the sandbox" line first;
    - `--codex` not claiming the MCP tools are refused;
    - `compact` printing the line again without installing;
    - a desktop-style run (process in the main checkout, `cwd` in the worktree) treated as the worktree;
    - exit 0 always.
  - `session-start`, install and toolchain:
    - install once, with a second run waiting for the lock and a stale lock taken over;
    - install again after `pnpm-lock.yaml` changes;
    - a failed install naming its log;
    - the install using the fake Nix's Node when no `CLAUDE_ENV_FILE` is set (Codex);
    - `$CLAUDE_ENV_FILE` getting one `export PATH=` holding only the four tools' folders, never the `sed` or `xcrun` ones, and written only once when the hook runs twice;
    - the cache shared by two worktrees, rebuilt when `flake.lock` changes or a cached folder is gone;
    - nothing written with Node 26 already first, or without Nix;
    - the session recorded for the guard.
  - `mcp-guard`:
    - deny JSON inside a worktree;
    - deny for a recorded worktree session whose `cwd` is outside git;
    - nothing in the main checkout;
    - allowed when `cwd` is missing and there's no record.

  Verify: they fail for the missing behaviour
- [x] 2.2 `scripts/worktree-hook.sh` with `session-start [--codex]` and `mcp-guard` (POSIX `sh` and `git`; JSON through `jq`, else `node`; Nix from `PATH` or `/nix/var/nix/profiles/default/bin/nix`); verify: 2.1 passes on macOS and under `dash` (Linux CI's `sh`), and `shellcheck scripts/*.sh bin/shorts-studio` reports nothing (run through `nix shell nixpkgs#shellcheck`)
- [x] 2.3 `.claude/settings.json`: `SessionStart` running `session-start` (timeout 600) and `PreToolUse` matching `mcp__shorts-studio__.*` running `mcp-guard`; both reach the script through `"$CLAUDE_PROJECT_DIR"`, quoted; verify: `jq . .claude/settings.json` parses, and piping a sample `PreToolUse` JSON with a worktree `cwd` into the configured command prints the deny
- [x] 2.4 `.codex/hooks.json` (`SessionStart`, matcher `startup`) and `.codex/environments/environment.toml` (`[setup]`) running `session-start --codex`; verify: `jq . .codex/hooks.json` parses, and both commands run by hand in the worktree print the Codex worktree line

## 3. Hooks and checks in worktrees

- [x] 3.1 Write the failing test first. `check-links` on a temporary repository passes with a broken link under `.claude/worktrees/x/` and under `.sandbox/posts/p/script.md`, with a tracked doc removed by `rm`, and with a doc whose name has non-ASCII letters. It fails on a broken link in a tracked doc and in an untracked, not-ignored doc. Verify: it fails for the missing behaviour
- [x] 3.2 `scripts/check-links.ts` takes its files from `git ls-files -z --cached --others --exclude-standard -- '*.md'`, drops paths that no longer exist, still skips `docs/vendors/`, and its logic is a function of the root folder; verify: 3.1 passes and `pnpm check-links` passes on the repository
- [x] 3.3 `lefthook.yml`: `biome` and `skills` skip with a `↷` message when their tool is missing; verify: in a worktree without `node_modules`, committing a `.ts` file succeeds and prints the skip line; with packages installed, a badly formatted file still gets fixed and staged
- [x] 3.4 `.gitattributes`: `CHANGELOG.md merge=union`; `linguist-generated` on `.claude/skills/**`, `pnpm-lock.yaml`, `flake.lock`, `schemas/*.json`; verify: `git check-attr merge -- CHANGELOG.md` prints `union`, and a scratch rebase of two branches that each add a line under `### Added` ends without a conflict with both lines kept

## 4. Builds-on lines and docs

- [x] 4.1 Add the `Builds on:` line from design decision 4 under the title of each of the ten pending proposals; verify: `openspec validate --all --strict` passes, and `session-start` run by hand in a worktree on a branch named `brand-look` reports `renderer-text-layers` as `open`
- [x] 4.2 Write `docs/worktrees.md`:
  - one lane per worktree, and the branch or desktop session named after its change;
  - starting from the desktop app, `claude --worktree <change>` or Codex;
  - pushing main first, and checking `git log -1` in a new worktree;
  - the sandbox, `SHORTS_SANDBOX` and `SHORTS_SANDBOX_DIR`;
  - why the MCP tools are refused, and how to test branch code over MCP with `bin/shorts-studio mcp serve`;
  - checking `doctor`'s data folder in a Codex worktree;
  - the shared-files table from design decision 7, linking to AGENTS.md's rules instead of repeating them;
  - looking at CHANGELOG.md after rebasing across a release;
  - finishing: PR merged, then remove the worktree;
  - the main checkout's role.

  Verify: `pnpm check-links` passes, and every command it shows runs as written in a worktree
- [x] 4.3 AGENTS.md: a row in "Where things are" pointing to docs/worktrees.md, and one "How to work" rule that links there for the details: write code in a worktree; the main checkout is for daily use, merges and archives; in a worktree use `bin/shorts-studio`, never `node apps/cli/src/main.ts`; prefix with `nix develop -c` when `node --version` isn't 26. `docs/getting-started.md` links to docs/worktrees.md from its agents section. Verify: `pnpm check-links` passes, and no fact appears both in AGENTS.md and docs/worktrees.md
- [x] 4.4 CHANGELOG.md `[Unreleased]`: one line on working in worktrees (sandbox, session start, MCP refusal); verify: the line names what a contributor would notice

## 5. Review, verify, ship

- [x] 5.1 `/code-review xhigh` on the branch. Check each finding against how this repository is really used (one developer, macOS, Claude Code desktop and Codex, worktrees under `.claude/worktrees/`) and fix only the confirmed ones, each with a test when it's behaviour; verify: every finding is listed as fixed or not applicable with the reason
- [x] 5.2 Run the `readability-improver` agent over the changed scripts and TypeScript, after the review fixes; verify: its edits keep every test passing
- [x] 5.3 Checks before pushing: `pnpm check && pnpm check-types && pnpm test && pnpm check-links` and `openspec validate --all --strict`; verify: all pass
- [x] 5.4 The `verify` skill in the worktree, walking every check in design decision 10. "The main checkout isn't sandboxed" is shown in a scratch clone's main checkout with scratch folders and fake keys, never with `config show` or `doctor` in the real main checkout: both read every real key from the Keychain. The live-session checks are marked `not walked`. Verify: the PR's `## Verification` section lists each with its result
- [ ] 5.5 Commits with the `commit` skill, grouped: code with its tests and config; the verify skill (`ai(skills)`); docs with the proposals and CHANGELOG. Show each preview and wait for the user's OK; verify: `git log origin/main..` shows the three commits
- [ ] 5.6 Open the PR with the `pr` skill, for the user's review; merging is the user's call; verify: the PR exists with its `## Verification` section and CI is green

## Workflow follow-up

- After the merge, run the live checks in design.md's Migration Plan, step 3, in a fresh worktree session.
- Archive the change with `openspec-archive-change`, which creates `openspec/specs/dev-worktrees/spec.md`.
- Update the session memory: the main checkout is for daily use; code goes in worktrees.
- Start Phase 1 (renderer-text-layers group 1) in its own worktree.
