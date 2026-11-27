# Parallel work in worktrees

Builds on: nothing

## Why

Ten changes are planned (renderer-text-layers, brand-look, carousel, daily-loop, agent-previews, review-page, video-beats, voice-music-animate, parallel-stories, attempt-history). Building them one at a time in one checkout is slow, and building them in parallel there is unsafe: sessions share one working tree, and commits have to be made by path. Git worktrees give each change its own checkout, but today a worktree is not ready to work in and not safe to run:

- **It runs branch code on your real posts.** `bin/shorts-studio` in a worktree uses the same data folder, ledger, caps and Keychain keys as daily use. Half-built code can change real posts or spend real money.
- **The MCP tools in a worktree session run the main checkout's code.** Claude Code's desktop app reads `.mcp.json` from the main checkout, so in a worktree session the `shorts-studio` tools act on real posts with code that isn't the branch's.
- **Its first commit fails.** The pre-commit hook calls `node_modules/.bin/biome`, which a new worktree doesn't have (exit 127), although `lefthook.yml` says each hook command skips when its tool is missing.
- **Agents' shell commands run on the wrong Node.** Outside `nix develop`, the shell has Node 24, while the repository needs Node 26 and ffmpeg-full.
- **Checks from the main checkout read other worktrees.** `check-links` walks into `.claude/worktrees/` and fails on another branch's work in progress.
- **Every branch edits the same lines.** Each change adds a line under `[Unreleased]` in CHANGELOG.md, so every rebase conflicts there.
- **Nothing says which change can start.** The order between changes is only in their prose.

## What Changes

- **Worktrees use a sandbox by default.** `bin/shorts-studio` (and `pnpm cli`, which now goes through it) uses a sandbox when its checkout is a linked worktree:
  - posts and data under the worktree's own `.sandbox/`, or under `SHORTS_SANDBOX_DIR`;
  - a fake value for every provider key, and a Keychain account that doesn't exist, so no real key is ever read;
  - every paid provider pointed at a dead local port.

  `SHORTS_SANDBOX=0` turns it off, and `SHORTS_SANDBOX=1` turns it on in the main checkout. Both variables join the list of `SHORTS_` variables that aren't settings, which today makes `doctor` fail on them. The verify skill uses the same sandbox code.
- **The MCP tools are refused in worktree sessions.** A Claude Code hook refuses `shorts-studio` MCP calls from a session that works in a worktree or opened in one, and says to use the worktree's `bin/shorts-studio` (sandboxed) instead.
- **A session start gets the worktree ready and says where it is.** One script, run by Claude Code's `SessionStart` hook and by Codex's setup script and hook:
  - in a worktree, installs the packages, and installs them again after the lockfile changes;
  - puts the project's Node 26, pnpm, ffmpeg-full and openspec first in the agent's shell commands when Nix is installed, and nothing else from the Nix shell;
  - prints one line, again after compaction: main checkout or worktree, the OpenSpec change the branch builds, its task progress, and whether the changes it builds on are archived.
- **Hooks and checks behave in worktrees.** The pre-commit commands skip with a message when their tool isn't installed, `check-links` skips `.claude/worktrees/`, and the sandbox folder is ignored by git.
- **Fewer conflicts between branches.** CHANGELOG.md merges line by line (`merge=union`), and generated files (the `.claude/skills/` copies, lockfiles, `schemas/`) are marked as generated, so reviews show the real code first.
- **Each pending change names what it builds on** in a `Builds on:` line in its proposal, which the session-start line reads.
- **`docs/worktrees.md`** explains how to work in a worktree: starting one per change, the sandbox, testing branch code over MCP, the files every branch touches and how to settle their conflicts, finishing. AGENTS.md links to it and gains one "How to work" rule: write code in a worktree; the main checkout is for daily use, merges and archives.

## Capabilities

### New Capabilities

- `dev-worktrees`: how the repository's own tooling behaves when work happens in git worktrees: the sandbox, the MCP refusal, session start, hooks and checks.

### Modified Capabilities

None. The product's behaviour (CLI, MCP, posts, spending) doesn't change: the Nix package and the release binaries never run `bin/shorts-studio`.

## Impact

- `bin/shorts-studio`, `package.json` (`cli`, a test task for `scripts/`), `turbo.json`, `lefthook.yml`, `.gitignore`, `.gitattributes`.
- New: `scripts/dev-sandbox.sh`, `scripts/worktree-hook.sh`, their tests, `docs/worktrees.md`, `.codex/hooks.json`, `.codex/environments/environment.toml`.
- `.claude/settings.json` (two hooks), `scripts/check-links.ts`, `NOT_SETTINGS` in `packages/providers/src/node.ts`, the verify skill's `sandbox.sh` and its way of stopping `mcp serve`, AGENTS.md, `docs/getting-started.md`, the ten pending proposals (one `Builds on:` line each).
- No new dependencies. Hooks need `sh`, `git`, and `jq` (shipped with macOS) or Node to read their input; the toolchain step needs Nix, and is skipped without it.

## Out of scope

- A tool that creates or removes worktrees: Claude Code, its desktop app and Codex already do that.
- Splitting `operations/index.ts`, `src/test/fakes.ts` or the Post schema into more files. Their conflicts are new lines next to each other, which a rebase settles by keeping both sides (see design.md).
- Refusing MCP calls in Codex sessions (its hook format for MCP tools isn't documented), and Windows support for the hooks.
- Limits on how many worktrees run at once. parallel-stories' render slots cover memory across every checkout on the machine.
- GitHub settings, such as deleting a branch when its PR merges. That's the repository owner's choice.
