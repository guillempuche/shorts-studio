# Spec Delta

## Purpose

How the repository's own tooling behaves when work happens in git worktrees, so several changes can be built at once without touching the user's real posts, keys or money.

## ADDED Requirements

### Requirement: A worktree's commands SHALL run in a sandbox

When `bin/shorts-studio` runs from a linked worktree, its posts and data SHALL live in the sandbox folder: `SHORTS_SANDBOX_DIR` when set, which SHALL be an absolute path, else the worktree's `.sandbox/`. `SHORTS_DATA_DIR` and `SHORTS_POSTS_DIR` from the environment SHALL be replaced. `pnpm cli` SHALL behave the same, because it runs `bin/shorts-studio`.

#### Scenario: Default in a worktree

- **GIVEN** a linked worktree and no `SHORTS_SANDBOX` in the environment
- **WHEN** `bin/shorts-studio post list` runs there
- **THEN** it lists the posts under `<worktree>/.sandbox/posts`, not the user's real posts

#### Scenario: The user's own data folder is set in the environment

- **GIVEN** a linked worktree and `SHORTS_DATA_DIR` pointing at the user's real data folder
- **WHEN** a command runs there
- **THEN** it uses `<worktree>/.sandbox/data`

#### Scenario: The verify skill chose its own sandbox

- **GIVEN** a linked worktree and `SHORTS_SANDBOX_DIR` set to an absolute scratch folder, as the verify skill sets it
- **WHEN** a command runs there
- **THEN** its posts and data live under that folder

#### Scenario: A relative sandbox folder

- **WHEN** a command runs in a worktree with `SHORTS_SANDBOX_DIR=tmp/x`
- **THEN** it stops with exit 2 and says the folder must be an absolute path

#### Scenario: Run from inside a git hook

- **GIVEN** `GIT_DIR` set to the main checkout's git folder, as git sets it for hooks
- **WHEN** a worktree's `bin/shorts-studio` runs
- **THEN** it still uses the sandbox

### Requirement: The sandbox SHALL make every paid provider unreachable

In the sandbox, every paid provider's key SHALL have a fake, non-empty value, and its address SHALL be a local port that refuses connections. A Keychain lookup SHALL find nothing, even for a key the sandbox didn't list, so no command can use a real key or send a paid request. A provider added later SHALL be covered without editing the sandbox.

#### Scenario: A paid command in a worktree

- **WHEN** `image generate` runs in a worktree without `--dry-run`
- **THEN** it fails before anything is sent, spends nothing, and the Keychain is never read

#### Scenario: A new provider

- **GIVEN** a new provider declared with its paid-service id and its key name
- **WHEN** a command runs in the sandbox
- **THEN** that provider's key is fake and its address is the dead port

#### Scenario: A key the sandbox didn't list

- **GIVEN** a key that is in the user's Keychain and that the sandbox set no fake value for
- **WHEN** a command looks it up in the sandbox
- **THEN** the lookup finds nothing

### Requirement: The sandbox SHALL be switchable

`SHORTS_SANDBOX=0` SHALL turn the sandbox off in a worktree, and `SHORTS_SANDBOX=1` SHALL turn it on in the main checkout. With no value, the sandbox SHALL be on in a linked worktree and off in the main checkout, and outside a git checkout.

#### Scenario: Main checkout

- **WHEN** `bin/shorts-studio` runs in the main checkout with no `SHORTS_SANDBOX`
- **THEN** it uses the user's real data folder and keys, as before

#### Scenario: Turned off in a worktree

- **WHEN** `SHORTS_SANDBOX=0 bin/shorts-studio post list` runs in a worktree
- **THEN** it uses the user's real data folder

#### Scenario: Turned on in the main checkout

- **WHEN** `SHORTS_SANDBOX=1 bin/shorts-studio post list` runs in the main checkout
- **THEN** it uses `<main checkout>/.sandbox`

### Requirement: The sandbox SHALL leave command output untouched

Setting up the sandbox SHALL print nothing on standard output, so `--json` output and the MCP protocol on standard output stay exactly as they are without it.

#### Scenario: JSON output in a worktree

- **WHEN** `bin/shorts-studio post list --json` runs in a worktree
- **THEN** standard output is only the command's JSON

#### Scenario: MCP server in a worktree

- **WHEN** `bin/shorts-studio mcp serve` answers `initialize` in a worktree
- **THEN** the first line on standard output is the JSON-RPC answer

### Requirement: Worktree sessions SHALL refuse the shorts-studio MCP tools

In a Claude Code session that works in a linked worktree, or that opened in one, every call to a `shorts-studio` MCP tool SHALL be refused before it runs, with a reason that names the worktree's `bin/shorts-studio` as the way to run branch code. Sessions working in the main checkout SHALL be unaffected.

#### Scenario: A tool call in a worktree session

- **GIVEN** a session whose working folder is inside a linked worktree
- **WHEN** it calls `post_list` on the `shorts-studio` MCP server
- **THEN** the call is refused, and the reason says to use `bin/shorts-studio` in the worktree

#### Scenario: A worktree session that left the worktree

- **GIVEN** a session that opened in a linked worktree and then moved to a folder outside git
- **WHEN** it calls `post_list`
- **THEN** the call is refused

#### Scenario: A tool call in the main checkout

- **WHEN** a session working in the main checkout calls `post_list`
- **THEN** the call runs as before

### Requirement: Opening a session SHALL get a worktree ready

When the session-start hook runs in a linked worktree whose packages are missing or older than its lockfile, it SHALL install them with the lockfile as it is, using the project's Node 26 when Nix is installed. Claude Code runs the hook for every session; Codex runs it once the project's hooks are trusted, and from its setup script. Two sessions opening the same worktree at once SHALL NOT install at the same time. A failed install SHALL NOT stop the session from opening.

#### Scenario: First session in a new worktree

- **WHEN** a session opens in a worktree with no `node_modules`
- **THEN** the packages get installed, and the first commit there runs the pre-commit checks

#### Scenario: The lockfile changed after a rebase

- **GIVEN** a worktree whose packages were installed, then rebased onto a commit that changed `pnpm-lock.yaml`
- **WHEN** a session opens there
- **THEN** the packages get installed again

#### Scenario: A Codex worktree outside the Nix shell

- **GIVEN** Node 24 first on `PATH`, Nix installed, and no `CLAUDE_ENV_FILE`
- **WHEN** Codex's setup runs the hook in a new worktree
- **THEN** the install runs on Node 26 and succeeds

#### Scenario: Two sessions open together

- **WHEN** two sessions open in the same new worktree at the same moment
- **THEN** one installs while the other waits, then finds the packages installed

#### Scenario: The install fails

- **WHEN** the install fails, for example with no network
- **THEN** the session still opens, and its first line names the log with the reason

### Requirement: Opening a session SHALL say where the agent works

When a session opens, and again after its context is compacted, the agent SHALL be told in one line whether it works in the main checkout (real posts) or a worktree (sandbox; MCP tools refused in Claude Code). In a worktree whose branch names an open OpenSpec change, the line SHALL give that change's tasks done and the status of each change it builds on.

#### Scenario: A worktree for a known change

- **GIVEN** a worktree on a branch named after the open change `brand-look`, which builds on `renderer-text-layers`
- **WHEN** a session opens there
- **THEN** its first line names the sandbox, `brand-look` with its tasks done out of all, and whether `renderer-text-layers` is archived

#### Scenario: A branch that names no change

- **WHEN** a session opens in a worktree whose branch matches no open change
- **THEN** the line says so, and the session opens as usual

#### Scenario: A desktop session's branch

- **GIVEN** a worktree on branch `claude/brand-look-x7f2` and the open change `brand-look`
- **WHEN** a session opens there
- **THEN** the line names `brand-look`

#### Scenario: A branch from before the sandbox

- **GIVEN** a worktree whose branch doesn't have the sandbox yet
- **WHEN** a session opens there
- **THEN** the line says first that this worktree's `bin/shorts-studio` uses real posts until the branch is rebased on main

#### Scenario: A detached HEAD

- **WHEN** a session opens in a worktree on a detached HEAD
- **THEN** the line says so and gives the command that starts a branch named after a change

#### Scenario: After compaction

- **WHEN** a worktree session's context is compacted
- **THEN** the line is printed again, and nothing is installed

#### Scenario: A Codex session

- **WHEN** a Codex session opens in a worktree
- **THEN** the line doesn't say the MCP tools are refused, and says to check `bin/shorts-studio doctor`'s data folder before using them

#### Scenario: Outside a git checkout

- **WHEN** the session-start hook runs in a folder that isn't a git checkout
- **THEN** it prints nothing and succeeds

### Requirement: Agent shell commands SHALL use the project's tools

When Nix is installed and the shell's Node isn't version 26, a Claude Code session SHALL put the project's Node 26, pnpm, ffmpeg-full and openspec first in its shell commands' `PATH`, and nothing else from the Nix shell. Without Nix, the session SHALL open unchanged.

#### Scenario: A session outside the Nix shell

- **GIVEN** Nix installed and Node 24 first on the user's `PATH`
- **WHEN** the agent runs `node --version` in its shell
- **THEN** it prints a version 26

#### Scenario: System tools stay the system's

- **WHEN** the agent runs `sed` or `xcrun` in such a session
- **THEN** they are the same programs the user's own `PATH` gives

#### Scenario: No Nix

- **WHEN** a session opens on a machine without Nix
- **THEN** it opens, and its shell commands use the user's own `PATH`

### Requirement: Checks run from one checkout SHALL ignore other worktrees

The link check SHALL check only the checkout it runs in, never the worktrees nested under `.claude/worktrees/`.

#### Scenario: A broken link in a nested worktree

- **GIVEN** a worktree under `.claude/worktrees/` with a broken link in its README
- **WHEN** the link check runs in the main checkout
- **THEN** it passes

#### Scenario: A doc deleted but not yet staged

- **WHEN** the link check runs in a checkout where a tracked doc was removed with `rm`
- **THEN** it checks the remaining docs and doesn't fail on the missing one

#### Scenario: A broken link in the checkout itself

- **WHEN** the link check runs in a checkout with a broken link in its docs
- **THEN** it fails and names the file and the link

### Requirement: Commit hooks SHALL skip a missing tool

Each pre-commit command SHALL skip with a message, instead of failing, when the tool it runs isn't installed in that checkout. CI SHALL still run every check.

#### Scenario: A worktree with no packages

- **GIVEN** a worktree with no `node_modules`
- **WHEN** a TypeScript file is committed there
- **THEN** the commit succeeds, and the hook says Biome was skipped and that CI will check

### Requirement: Changelog lines from two branches SHALL both survive a rebase

Lines that two branches add next to each other in CHANGELOG.md SHALL both be kept when one branch is rebased on the other, with no conflict.

#### Scenario: Two branches add a line under the same heading

- **GIVEN** `main` and a branch each added a line under `[Unreleased]` → `### Added`
- **WHEN** the branch is rebased on `main`
- **THEN** the rebase finishes without a conflict, and both lines are there
