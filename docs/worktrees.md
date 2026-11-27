# Working in worktrees

Several changes can be built at once, each in its own git worktree with its own agent session. The main checkout stays for daily use (making posts with your real keys), merging and archiving changes. Code is written in worktrees.

## Starting one

One worktree per OpenSpec change. Name its branch, or its desktop session, after the change: the session's first lines then show that change's tasks done and whether the changes it builds on (the `Builds on:` line of its proposal) are archived yet.

Push `main` before you start one: new worktrees branch from the remote's `main`, not from commits you haven't pushed. In a new worktree, `git log -1` shows which commit it starts from.

- **Claude Code desktop app:** start a session in a worktree and name it after the change. Its branch is `claude/<name>-<suffix>`, which still finds the change.
- **Claude Code CLI:** `claude --worktree <change>` makes `.claude/worktrees/<change>/` on branch `worktree-<change>`.
- **Codex:** the app makes the worktree and runs the setup in `.codex/environments/environment.toml`. Its `SessionStart` hook (`.codex/hooks.json`) runs only once Codex trusts the project's hooks ([getting started](getting-started.md#codex)).
- **By hand:** `git worktree add .claude/worktrees/<change> -b <change> origin/main`, then open a session there, or run `sh scripts/worktree-hook.sh session-start` in it.

## What happens when a session opens

`scripts/worktree-hook.sh` runs by itself (Claude Code's `SessionStart` hook in `.claude/settings.json`, and Codex's setup and hook). Its header says what it does in detail. In short:

- in a worktree, it installs the packages, and installs them again after `pnpm-lock.yaml` changes, for example after a rebase. The log is `shorts-worktree-install.log` in the worktree's git folder;
- when your shell's Node isn't 26 and Nix is installed, it puts the project's Node 26, pnpm, ffmpeg-full and openspec first in Claude Code's shell commands, and nothing else from the Nix shell;
- it prints a few lines for the agent: main checkout or worktree, the change, its tasks done, and what it builds on. After `/compact`, the lines come back.

## The sandbox

In a worktree, `bin/shorts-studio` and `pnpm cli` run in a sandbox, so code that isn't finished can't touch your posts, keys or money (`scripts/dev-sandbox.sh`):

- posts and data live in the worktree's `.sandbox/`, which git ignores and which goes when the worktree goes;
- every paid provider points at a local port that refuses connections, every key is fake, and Keychain lookups ask for an account that doesn't exist;
- `bin/shorts-studio doctor` shows the sandbox's folders and one `127.0.0.1:9` line per provider.

Don't run `node apps/cli/src/main.ts` in a worktree: it skips the sandbox. `SHORTS_SANDBOX=0` turns the sandbox off for one command, and `SHORTS_SANDBOX=1` turns it on in the main checkout. `SHORTS_SANDBOX_DIR=<absolute path>` puts it somewhere else, as the verify skill does.

A worktree whose branch predates the sandbox has none: its session says so first. Rebase it on main (`git fetch origin && git rebase origin/main`) before running `bin/shorts-studio`.

## MCP tools in a worktree

In a Claude Code worktree session, the `shorts-studio` MCP tools are refused. Claude Code starts that server from the main checkout, so it would run the main checkout's code on your real posts, not the branch's. To try the branch's code over MCP, start `bin/shorts-studio mcp serve` in the worktree and send it JSON-RPC, as the [verify skill](../.agents/skills/verify/SKILL.md) does: it runs in the sandbox.

Nothing refuses them in Codex. Before using them in a Codex worktree, check that `bin/shorts-studio doctor` shows a data folder under `.sandbox/`.

## Files every branch touches

Most of the planned changes edit these files, so rebasing one lane onto another often meets them. How to settle each:

| File                                                                 | On a conflict                                                                                                                                                                                            |
| -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/usecases/src/operations/index.ts`                          | keep both sides' lines, in `--help` order                                                                                                                                                                |
| `packages/domain/src/post.ts`, `packages/usecases/src/test/fakes.ts` | keep both sides. A new part of the post, or a new port's fake, goes in a file of its own, with one line added here                                                                                       |
| `schemas/*.json`                                                     | take either side, then regenerate them ([AGENTS.md, checks before pushing](../AGENTS.md#how-to-work))                                                                                                    |
| `.claude/skills/**`                                                  | settle `.agents/skills/**`, then sync the copy ([AGENTS.md, Skills](../AGENTS.md#skills))                                                                                                                |
| `pnpm-lock.yaml`, the `pnpmDeps` hash in `flake.nix`                 | take `main`'s, run `pnpm install`, then update the hash ([AGENTS.md, checks before pushing](../AGENTS.md#how-to-work)). Add a dependency in its own small commit on `main` before the lanes that need it |
| `CHANGELOG.md`                                                       | no conflict: lines two branches add are both kept (`merge=union` in `.gitattributes`). After rebasing across a release, check that your line is still under `[Unreleased]`                               |
| `openspec/specs/*`                                                   | only changes when a change is archived, on `main`, one change at a time                                                                                                                                  |

## Finishing

Bring the branch up to date with `git rebase origin/main`. Once its pull request is merged, remove the worktree:

- **Claude Code CLI:** exiting the session offers to remove it;
- **desktop app:** archive the session;
- **by hand:** `git worktree remove .claude/worktrees/<change>`, then `git branch -D <change>`.

Archive the OpenSpec change from the main checkout.
