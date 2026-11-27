# Design

## Context

See proposal.md for why. These facts shape the design. Each was checked on 2026-11-23: by a test in a scratch clone, by reading the code, or in Claude Code's documentation.

| Fact                                                                                                                                                                                                                                                                                      | How it was checked                                                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| In a worktree with no `node_modules`, a commit fails at `biome` with exit 127                                                                                                                                                                                                             | Scratch clone: `git worktree add`, then a commit                                                                                                             |
| `pnpm install --frozen-lockfile` in a new worktree takes about 3.5 s, and commits then pass                                                                                                                                                                                               | Scratch clone, timed                                                                                                                                         |
| Installing in a worktree rewrites the shared `.git/hooks/pre-commit` to that worktree's lefthook. Once that worktree is removed, the main checkout still commits, because the hook falls back to its own `node_modules`                                                                   | Scratch clone: install in a worktree, remove it, commit in main                                                                                              |
| `node scripts/check-links.ts` in the main checkout reports a broken link inside `.claude/worktrees/<name>/`                                                                                                                                                                               | Scratch clone                                                                                                                                                |
| `CHANGELOG.md merge=union` keeps both branches' lines through a rebase, with no conflict                                                                                                                                                                                                  | Scratch repository, `git rebase`                                                                                                                             |
| `nix develop <worktree> -c true` takes about 11 s the first time and 7.6 s after                                                                                                                                                                                                          | Scratch clone, timed                                                                                                                                         |
| `nix develop -c <command>` prints the shell's banner (`shorts-studio: node …`) on standard output before the command's own output                                                                                                                                                         | `nix develop -c openspec instructions … --json` failed to parse                                                                                              |
| Only the `/nix/store` entries of the Nix shell's `PATH` are needed for Node 26, pnpm 12, ffmpeg-full and openspec                                                                                                                                                                         | `env -i PATH=<those entries> node --version`                                                                                                                 |
| The shell outside Nix has Node 24; the repository needs Node 26 (`engines`)                                                                                                                                                                                                               | `node --version` in this session                                                                                                                             |
| A key is read from the environment and, when that is empty, from the Keychain (`env[key.env] \|\| keychain(…)`), so the sandbox needs non-empty fake keys                                                                                                                                 | `packages/providers/src/node.ts:527`                                                                                                                         |
| Any `SHORTS_` variable that isn't a setting, isn't in `NOT_SETTINGS` and isn't a `SHORTS_<ID>_URL` is reported as an issue                                                                                                                                                                | `packages/providers/src/node.ts:261-290`                                                                                                                     |
| A running MCP server's command line is `node … /bin/../apps/cli/src/main.ts mcp serve`, because `bin/shorts-studio` uses `exec`. The verify skill's `pkill -f 'shorts-studio mcp serve'` therefore matches nothing, and widening the pattern would also stop every other session's server | `pgrep -fl "mcp serve"` showed four servers                                                                                                                  |
| In desktop-app worktree sessions, Claude Code reads settings, hooks, skills and `.mcp.json` from the main checkout's root                                                                                                                                                                 | code.claude.com/docs/en/worktrees, "What worktrees share with the main checkout"                                                                             |
| `${CLAUDE_PROJECT_DIR}` stays at the folder where the session started; the hook input's `cwd` follows the session into the worktree                                                                                                                                                       | code.claude.com/docs/en/worktrees                                                                                                                            |
| `SessionStart` input has `cwd` and `source` (`startup`, `resume`, `clear`, `compact`, `fork`); its plain standard output goes into the agent's context; command hooks time out after 600 s by default                                                                                     | code.claude.com/docs/en/hooks                                                                                                                                |
| A `SessionStart` hook can write `export` lines to `$CLAUDE_ENV_FILE`, and every later Bash command runs them first. Nothing documents that MCP servers get them                                                                                                                           | code.claude.com/docs/en/hooks, "Persist environment variables"                                                                                               |
| `claude --worktree <name>` makes `.claude/worktrees/<name>/` on branch `worktree-<name>`, from the remote's default branch unless `worktree.baseRef` is `head`                                                                                                                            | code.claude.com/docs/en/worktrees                                                                                                                            |
| The desktop app's worktree sessions ignore `worktree.baseRef`. Their base commit isn't documented. Their branches are `<branch prefix>/<name>`, and the prefix here is `claude`                                                                                                           | code.claude.com/docs/en/desktop; the app's settings                                                                                                          |
| In desktop worktree sessions, hook commands run in the main checkout's root, and `${CLAUDE_PROJECT_DIR}` points there. So a hook must read the worktree from its input's `cwd`, not from `$PWD`                                                                                           | code.claude.com/docs/en/worktrees                                                                                                                            |
| `SessionStart` fires in a desktop worktree session with `cwd` in the worktree                                                                                                                                                                                                             | A sibling repository using the same hook: its desktop worktree's install log was written at 09:52, and that worktree's first commit is at 09:54 the same day |
| A desktop worktree can be on a detached HEAD                                                                                                                                                                                                                                              | The same sibling repository: two of its three worktrees are detached                                                                                         |
| Whether `$CLAUDE_ENV_FILE` keeps its content across `resume` or `clear` isn't documented                                                                                                                                                                                                  | code.claude.com/docs/en/hooks                                                                                                                                |
| A `PreToolUse` matcher `mcp__shorts-studio__.*` is a regular expression matching every tool of that server. The deny answer is `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"…"}}` with exit 0, and Claude sees the reason | code.claude.com/docs/en/hooks                                                                                                                                |
| `jq` ships with macOS (`/usr/bin/jq`, macOS 26.6.2)                                                                                                                                                                                                                                       | `ls /usr/bin/jq`                                                                                                                                             |
| The rule "the checkout of `realpath bin/shorts-studio` has a git folder different from the common one" gives main, worktree, worktree (through a symlink), not-git and main (when called from inside a worktree) in those five cases, in about 24 ms                                      | Scratch clone                                                                                                                                                |
| Node's `fetch` refuses port 9 before connecting ("bad port")                                                                                                                                                                                                                              | `node -e 'fetch("http://127.0.0.1:9")…'`                                                                                                                     |
| A root `test:scripts` task runs through `pnpm test` when `test` is `turbo run test test:scripts` and `turbo.json` has `//#test:scripts`                                                                                                                                                   | Scratch clone                                                                                                                                                |
| `nix shell nixpkgs#shellcheck` works; it takes about 29 s the first time                                                                                                                                                                                                                  | Run once                                                                                                                                                     |
| `openspec validate --all --strict` passes with a `Builds on:` line under a proposal's title                                                                                                                                                                                               | Scratch clone                                                                                                                                                |
| The Nix package copies `package.json node_modules apps packages`, never `bin/`, so changing `bin/shorts-studio` can't change the product                                                                                                                                                  | `flake.nix:78`                                                                                                                                               |
| With today's code, `SHORTS_SANDBOX=1` makes `doctor` fail with a blocking "not a setting" problem                                                                                                                                                                                         | Run in a scratch sandbox                                                                                                                                     |
| With scratch folders, fake keys and dead ports, `doctor` shows both folders and one `! SHORTS_<ID>_URL … 127.0.0.1:9` line for each provider, and `post list --json` prints only its JSON                                                                                                 | Run in a scratch sandbox                                                                                                                                     |
| The detection rule and the JSON read give the same answers under `dash` (Linux CI's `/bin/sh`)                                                                                                                                                                                            | `dash` 0.5.13 from nixpkgs                                                                                                                                   |
| CI sets no git identity, and no test uses git today. The developer's global git config signs commits (`commit.gpgsign=true`, `gpg.format=ssh`)                                                                                                                                            | `.github/workflows/*.yml`; `git config --global`                                                                                                             |
| The dev shell's `PATH` holds clang, coreutils, cctools, `xcrun`, findutils, GNU sed, grep and awk, bash and more, besides node, pnpm, ffmpeg and openspec. `nix print-dev-env --json` gives it in about 1 s, with no banner                                                               | `nix print-dev-env --json .`, then `command -v sed xcrun bash` resolves to the Nix ones                                                                      |
| `keychain()` looks a key up as `security find-generic-password -a "$USER" -s <service>`                                                                                                                                                                                                   | `providers/src/node.ts:401-407`                                                                                                                              |
| `config show` and `doctor` read every key, so running them in the main checkout touches the real Keychain                                                                                                                                                                                 | `usecases/src/operations/config.ts:33-34, 158-170`                                                                                                           |
| Nix is installed at `/nix/var/nix/profiles/default/bin/nix`                                                                                                                                                                                                                               | `ls`                                                                                                                                                         |

A sibling repository by the same developer runs this pattern every day: one `worktree-hook.sh` called by Claude Code's `SessionStart` and by Codex's setup script and `SessionStart` hook, with a lock so two sessions don't install at once. This design keeps that shape and drops what shorts-studio doesn't need (databases, buckets, local addresses, a worktree CLI, slot limits).

## Goals / Non-Goals

**Goals:**

- Running branch code can't touch real posts, keys or money, whichever way it's started: `bin/shorts-studio`, `pnpm cli`, `mcp serve`, or the session's MCP tools.
- A new worktree needs nothing done by hand before its first test or commit.
- The agent knows at session start where it is and what its change builds on.
- What the plan for the ten changes says about order can be read by a script.

**Non-Goals:**

- Isolating `node apps/cli/src/main.ts` run directly. Docs and AGENTS.md say to use `bin/shorts-studio`.
- Running the user's daily work in a worktree. That's what the main checkout is for.

## Decisions

### 1. The sandbox lives in `bin/shorts-studio`, decided by where that file is

`bin/shorts-studio` asks git whether its own checkout is a linked worktree: `git rev-parse --absolute-git-dir` differs from `--path-format=absolute --git-common-dir`.

- It decides from the script's real location (`realpath "$0"`), not from the current folder, so a worktree's `bin` always sandboxes and the main checkout's never does, wherever it's called from.
- It runs that check with `GIT_DIR`, `GIT_WORK_TREE` and `GIT_INDEX_FILE` removed from the environment (`env -u`). Git exports them to hooks, and an inherited `GIT_DIR` made a worktree look like the main checkout.

`SHORTS_SANDBOX` wins when set: `0` is off, `1` is on. When on, `scripts/dev-sandbox.sh` (sourced, prints nothing):

- **The folder.** It uses `$SHORTS_SANDBOX_DIR` when set (the verify skill's scratch folder), else `<checkout>/.sandbox`. A `SHORTS_SANDBOX_DIR` that isn't an absolute path stops the command with exit 2 and says why. The variable has its own name, rather than the generic `SANDBOX`, because other tools set `SANDBOX`.
- **Posts and data.** It exports `SHORTS_DATA_DIR` and `SHORTS_POSTS_DIR` under that folder, replacing any value from the user's environment, and creates both.
- **Paid providers.** It exports `SHORTS_<ID>_URL=http://127.0.0.1:9` for every `PaidService` id, and a fake value for every `KeySpec` env name. They're found by the same `grep` over `packages/providers/src/*.ts` that the verify skill uses today. That grep moves here, and the verify skill's `sandbox.sh` keeps its own `mktemp` folder, exports `SHORTS_SANDBOX=1` and `SHORTS_SANDBOX_DIR="$SANDBOX"`, sources this file, and keeps its own messages.
- **The Keychain.** It exports `USER=shorts-sandbox`. `keychain()` looks keys up with `security find-generic-password -a "$USER"` (`providers/src/node.ts:401-407`), so with an account that doesn't exist, no Keychain lookup finds anything, including a key the grep missed. The verify skill's gotchas already recommend this. Defence in depth matters here because the grep reads one line per declaration: a declaration Biome wraps, a key written inline in a `PaidService`, or a provider in a subfolder would escape it without a word. A guard test also counts every `: PaidService =` and `: KeySpec =` declaration in the providers and fails when the discovery found fewer.

`SHORTS_SANDBOX` and `SHORTS_SANDBOX_DIR` join `NOT_SETTINGS` in `packages/providers/src/node.ts`. Today `SHORTS_SANDBOX=1` makes `doctor` fail with a blocking "not a setting" problem. That is this change's only edit to product code. `pnpm cli` changes from `node apps/cli/src/main.ts` to `bin/shorts-studio`, so it gets the same rule.

Alternatives considered:
- _In the product's `resolvePaths`_: the Nix package and the release binaries would run git on every start and learn about developer checkouts. Rejected.
- _Only through `$CLAUDE_ENV_FILE`_: it covers Claude Code's Bash, not the user's terminal, Codex, or an `mcp serve` the verify skill starts. Rejected as the main mechanism.
- _direnv_: it needs `direnv allow` in each worktree, and Claude Code's shell doesn't load direnv. Rejected.
- _Respecting the environment's `SHORTS_DATA_DIR` in a worktree_: one exported in the user's shell profile would point the worktree at real posts. Rejected. `SHORTS_SANDBOX_DIR` is the one way to choose the folder.

### 2. MCP tools are refused in worktree sessions by a `PreToolUse` hook

In desktop worktree sessions, `.mcp.json` comes from the main checkout, so the `shorts-studio` server runs the main checkout's code on real posts. No documented input tells that server which worktree the session is in, but Claude Code's hook input says it: `cwd` and `session_id`. So a `PreToolUse` hook matching `mcp__shorts-studio__.*` runs `scripts/worktree-hook.sh mcp-guard`, which denies (`permissionDecision: "deny"`) when either holds:

- `cwd` is inside a linked worktree;
- `session-start` recorded this `session_id` as a worktree session. It writes `<common git dir>/shorts-sessions/<session_id>`, holding the worktree's path. This covers a worktree session that has since `cd`'d somewhere outside git, such as the verify skill's scratch folder.

The reason says: run `bin/shorts-studio` in the worktree, or start `bin/shorts-studio mcp serve` there, as the verify skill does. Otherwise it allows: in the main checkout, or with no readable `cwd` and no record. Failing open keeps daily use working; the risk that leaves is covered in Risks. `session-start` deletes records older than 30 days.

Alternatives considered:
- _A server that runs the branch's code_: it would have to know the session's worktree. Rejected.
- _Removing the server from `.mcp.json`_: daily use needs it. Rejected.

### 3. One POSIX `sh` script runs at session start, for Claude Code and Codex

`scripts/worktree-hook.sh session-start` runs before any package is installed and possibly outside Nix, so it needs only `sh`, `git`, and `jq` or Node to read its JSON input. It always exits 0. Its steps:

1. **Find the checkout.**
   - Read `cwd`, `source` and `session_id` from the input. Without a readable `cwd`, use `$PWD`, which in a desktop worktree session is the main checkout: the session then gets the main checkout's line and no install, and nothing breaks.
   - Stop quietly outside a git checkout.
   - When `source` is `compact`, skip steps 2 and 3 and only print the line again (step 4), because compaction is when the agent loses it.
2. **Toolchain.** If `node --version` isn't `v26.*` and Nix exists (on `PATH`, else at `/nix/var/nix/profiles/default/bin/nix`, since a GUI app's hook may not inherit the shell's `PATH`), the script works out the project's tools:
   - **Read the `PATH`.** It reads the dev shell's `PATH` with `nix print-dev-env --json "$root"`. That takes about 1 s, prints no banner, and doesn't run the shellHook's `lefthook install`.
   - **Keep only the four tools.** It keeps only the entries whose `bin` holds `node`, `pnpm`, `ffmpeg` or `openspec`. The dev shell's full `PATH` also carries clang, GNU coreutils, sed, grep and awk, bash and an `xcrun`, which would shadow the system's own in every session (BSD `sed -i ''`, Xcode's `xcrun`).
   - **Cache.** The result is cached in the common git folder (`<common>/shorts-devshell-path`), shared by every checkout, keyed by `git hash-object flake.nix flake.lock`. It's computed again when the key changes or a cached folder is gone after `nix store gc`.
   - **Who gets it.** It's used by step 3 for Claude Code and Codex alike, because `engineStrict` makes `pnpm install` fail on Node 24. Only when `$CLAUDE_ENV_FILE` is set (Claude Code) does it also add `export PATH="<entries>:$PATH"` there. It adds the line only when that exact line isn't there yet: whether the file survives `resume` or `clear` isn't documented, and appending each time would repeat the entries.
   - **Where it runs.** This runs in the main checkout too: it removes the "push inside nix develop" friction there as well. There is no switch to turn it off: it only puts the project's own four tools first.
3. **Install (linked worktree only).**
   - It takes a lock, `mkdir <gitdir>/shorts-session.lock` holding its process id; a lock whose process is gone is taken over.
   - It runs `pnpm install --frozen-lockfile` with the toolchain from step 2 when `node_modules/.modules.yaml` is missing, or when `pnpm-lock.yaml`'s hash differs from the one saved after the last install that succeeded (`<gitdir>/shorts-installed-lock`). A lane that rebased onto a new dependency then gets it at its next session. With neither Node 26 nor Nix, it skips and says how to install.
   - Output goes to `<gitdir>/shorts-worktree-install.log`.
   - It records the session (`<common>/shorts-sessions/<session_id>`) for the MCP guard.
4. **Say where.** One line for the agent:
   - main checkout: "real posts and keys; write code in a worktree (docs/worktrees.md)";
   - worktree: "sandbox in `.sandbox/`, MCP tools refused", the change and its progress, what it builds on, or the install log on failure;
   - a worktree whose branch has no `scripts/dev-sandbox.sh` predates this change, so its `bin/shorts-studio` would use real posts. The line says so first: "rebase on main before running `bin/shorts-studio`". In a desktop session the hook comes from the main checkout, so it runs even there.

Codex runs the same script as `session-start --codex`, from `.codex/environments/environment.toml` (`[setup]`) and from `.codex/hooks.json` (`SessionStart`, matcher `startup`), with the same keys as the sibling repository's working setup.

- Codex runs project hooks only once they're trusted, so its part is best effort.
- With `--codex`, the worktree line doesn't claim the MCP tools are refused. Nothing refuses them in Codex. Instead it says to check `bin/shorts-studio doctor`'s data folder before using them.
- Codex has no `$CLAUDE_ENV_FILE`, so its shell keeps the user's `PATH`. AGENTS.md keeps the hint to prefix commands with `nix develop -c` when `node --version` isn't 26.

No `WorktreeCreate` or `WorktreeRemove` hook and no `.worktreeinclude`: nothing outside the worktree's folder needs creating or cleaning, and no ignored file needs copying, because keys stay in the environment or the Keychain.

### 4. The branch names the change, and each proposal says what it builds on

The script matches the branch to an open change:
- take the branch's last `/` segment, without a leading `worktree-`;
- that name exactly, or else the longest open change name contained in it. The desktop app's branches are `claude/<session name>-<suffix>`, so a session named `brand-look` gives `claude/brand-look-x7f2` → `brand-look`;
- on a detached HEAD, the line says so and gives the command to start a branch: `git switch -c <change>`.

Tasks done are counted in `tasks.md` by OpenSpec's own rule (a box holding only `x`, any case).

Each pending proposal gets one line under its title, `Builds on: <change>, <change>` or `Builds on: nothing`. It lists only changes that must be archived before work starts; parts that light up later stay in the proposal's prose. A dependency is `archived` when `openspec/changes/archive/*-<name>` exists in the worktree, `open` when `openspec/changes/<name>` exists, and `unknown` otherwise. The worktree reads its own files, which reflect its base commit, so the line says "as of this branch".

| Change               | Builds on                        |
| -------------------- | -------------------------------- |
| renderer-text-layers | nothing                          |
| brand-look           | renderer-text-layers             |
| carousel             | renderer-text-layers, brand-look |
| daily-loop           | renderer-text-layers, brand-look |
| agent-previews       | renderer-text-layers, brand-look |
| review-page          | agent-previews, carousel         |
| video-beats          | renderer-text-layers             |
| voice-music-animate  | video-beats                      |
| parallel-stories     | nothing                          |
| attempt-history      | nothing                          |

Soft links stay in prose: agent-previews' `--slide`/`--cover` need carousel and daily-loop, and its clip frames need video-beats; carousel's clip frames need video-beats; voice-music-animate's voices and music need nothing.

### 5. The link check walks git's list of files

`check-links` takes its files from `git ls-files -z --cached --others --exclude-standard -- '*.md'`.

- That leaves out everything `.gitignore` leaves out: `.claude/worktrees/`, `.sandbox/` (whose posts have `script.md` files) and `node_modules`. Git never descends into a nested worktree either.
- `-z` keeps paths with non-ASCII letters unquoted.
- Paths that no longer exist are dropped. A doc removed with a plain `rm` is still listed until the removal is staged.
- It keeps skipping `docs/vendors/`, and it still checks a new doc before it's committed.
- Its logic becomes a function of the root folder, so a test can run it on a scratch repository.

Alternative considered: adding `worktrees` and `.sandbox` to the `SKIP` names. That would miss other ignored folders, and skip any folder named `worktrees`. Rejected.

### 6. Commit hooks skip what isn't installed

In `lefthook.yml`, `biome` runs only if `node_modules/.bin/biome` exists, and `skills` only if `node` exists. Otherwise each prints `↷ … skipping (CI will check)`, like the pre-push commands. CI already runs both (`pnpm check`, `skills-sync.ts --check`).

### 7. Fewer and easier conflicts

- `.gitattributes`: `CHANGELOG.md merge=union`. Lines two branches add to the same section are both kept. If both branches edit the same line, union keeps both versions, which the release step's read of CHANGELOG catches. After a release has moved `[Unreleased]` into a version section, a lane's rebased line can land under the released heading without a conflict, so docs/worktrees.md says to look at CHANGELOG.md after rebasing across a release.
- `linguist-generated` on `.claude/skills/**`, `pnpm-lock.yaml`, `flake.lock` and `schemas/*.json`, so GitHub collapses them in reviews.
- `docs/worktrees.md` lists the files every branch touches and how to settle each one:

| File                                                    | On conflict                                                                                                                                                 |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `operations/index.ts` (array of operations)             | keep both lines, in help order                                                                                                                              |
| `src/test/fakes.ts`, `domain/src/post.ts` (Post struct) | keep both; put a new sub-schema or a new port's fake in its own file and add one line here                                                                  |
| `schemas/*.json`                                        | take either side, then follow AGENTS.md's rule for the schemas (link, not a copy)                                                                           |
| `.claude/skills/**`                                     | settle `.agents/skills/**`, then follow AGENTS.md's Skills section (link)                                                                                   |
| `pnpm-lock.yaml`, `flake.nix` `pnpmDeps`                | take main's, `pnpm install`, then AGENTS.md's rule for the `pnpmDeps` hash (link). Add a dependency in a small commit on main before the lane that needs it |
| `openspec/specs/*`                                      | conflicts happen only at archive, which runs on main one change at a time; re-check any MODIFIED requirement after the previous change's sync               |

Splitting `operations/index.ts`, `fakes.ts` or the Post schema now was considered and rejected. The conflicts there are lines added next to each other, which a rebase settles by keeping both sides. Several pending changes add `post *` commands, so a split by module would move the conflict without removing it. And the move itself is a large diff with no change in behaviour.

### 8. The verify skill stops only the server it started

The skill starts `bin/shorts-studio mcp serve` in the background and writes `$!` to `$SANDBOX/mcp.pid`, because Claude Code runs each Bash call in a new shell and `$!` doesn't survive to the next one. At the end it stops that process id. Today's `pkill -f` stops nothing (see Context), and any pattern that did match would also stop other sessions' servers. The skill keeps its own `mktemp` folder, so "delete `$SANDBOX`" at the end never removes a worktree's `.sandbox/`.

### 9. Order of the ten changes: lanes

The user's review is the bottleneck, not agents: the three earlier changes' xhigh reviews found 6, 8 and 12 real problems. So at most three lanes run at once, one worktree each:

- **Phase 0, on main:** the verify skill's in-progress work (untracked `.agents/skills/verify/`, edits to AGENTS.md and the pending `tasks.md` files) is committed first, then this change. Push main before opening a lane: Claude Code branches worktrees from the remote's `main`.
- **Phase 1, one lane:** renderer-text-layers group 1 (the pure refactor: `Renderer` port, `motionAt`, `textAt`, frame-snapped `toAss`, draft jobs, `render.text`, the split draft hash). Merge it before anything else starts: five changes build on it directly (brand-look, carousel, daily-loop, agent-previews, video-beats), and two more through them (review-page, voice-music-animate). Pin Takumi and update the flake hash in their own commit on main.
- **Phase 2, three lanes:**
  - **A, look:** the rest of renderer-text-layers → brand-look → carousel → daily-loop
  - **B, video:** video-beats → voice-music-animate
  - **C, ops:** parallel-stories → attempt-history (one after the other: both change `image.ts`)
- **Phase 3:** agent-previews (`caption fix`, `caption break` and `draft check` can start once brand-look is archived, `--slide` and `--cover` after carousel and daily-loop) → review-page.

This order is a recommendation for the user, not a file the hook reads. The hook reads only the `Builds on:` lines.

### 10. How this change itself is built

It's built in a worktree on branch `parallel-worktrees`, from `origin/main` after Phase 0 is pushed. Its hooks only take effect after the merge, because Claude Code reads hooks from the main checkout, so until then the scripts run by hand and through their tests:

- **Tests** (the `test-bdd` skill: `should …` names, GIVEN / WHEN / THEN), only where they guard behaviour:
  - `bin/shorts-studio` plus `dev-sandbox.sh`;
  - `worktree-hook.sh` (`session-start`, `mcp-guard`, the lock, branch matching, `Builds on:` statuses);
  - `check-links`;
  - `NOT_SETTINGS`.

  They run on temporary git repositories, with fake `pnpm`, `nix`, `node` and `security` programs first on `PATH`, so they need no network, no Nix and no Keychain.
  - **Git.** Git runs with `GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_NOSYSTEM=1`, an explicit identity and no inherited `GIT_*`. The developer's global config signs commits with SSH, and CI has no identity.
  - **Paths.** One temporary path holds a space.
  - **Where they run.** They go in a root `scripts` vitest project that `pnpm test` runs. No tests for `.gitattributes`, `lefthook.yml`, settings files, docs or the `Builds on:` lines: their behaviour is git's or Claude Code's, and they're checked once in verify.
- **During the build:** debug each failure from its output before changing code.
- **Review:** `/code-review xhigh`. Check each finding against how this repository is really used before fixing it, and fix only the confirmed ones.
- **Readability:** after the review fixes, run the `readability-improver` agent over the changed code, so it polishes the final version, then run the tests again.
- **Verify:** the `verify` skill, in a worktree:
  - `doctor` shows the dead ports;
  - `post list --json` is clean JSON from an empty sandbox;
  - `mcp serve` answers `initialize` on its first line;
  - an `image generate` against the dead port spends nothing;
  - the commit hook skips without `node_modules`;
  - a scratch rebase keeps both CHANGELOG lines;
  - each hook mode run by hand with sample JSON.

  The checks that need a real Claude Code session are marked `not walked` until after merge: a new worktree session prints the line and refuses the MCP tools.
- **Commits** (the `commit` skill, grouped): code with its tests and config; the verify skill; docs together with the `Builds on:` lines and the CHANGELOG. Then one PR with the `pr` skill, opened for the user's review. Merging is the user's call.

## Risks / Trade-offs

- [The MCP guard fails open when `cwd` can't be read] → `cwd` is a documented common field. A worktree session that slipped through would reach main's code on real posts, which is today's behaviour, not a new risk. Paid calls still ask first (`ask` rules).
- [Codex sessions aren't guarded] → `.codex/config.toml` starts `bin/shorts-studio` with a relative path. If Codex resolves it in the worktree, its `bin` sandboxes. If it resolves it in the main checkout, real posts are reachable. Not verified: docs/worktrees.md says to check `doctor`'s data folder in a Codex worktree before trusting it.
- [A direct `node apps/cli/src/main.ts` in a worktree skips the sandbox] → AGENTS.md and docs/worktrees.md say to use `bin/shorts-studio`. The existing deny rules for approvals still match `main.ts`.
- [`$CLAUDE_ENV_FILE` puts Nix paths before the user's `PATH` in every session] → only the four folders holding node, pnpm, ffmpeg and openspec. The dev shell's compilers and GNU tools stay out, so system `sed`, `xcrun` and `bash` are untouched.
- [`USER=shorts-sandbox` reaches the CLI's child processes (ffmpeg, yt-dlp)] → they read `HOME`, not `USER`, for their files. The change applies only in the sandbox.
- [A provider declaration that the grep can't read would escape the sandbox] → the guard test in design decision 1.
- [The desktop app's base commit for new worktrees isn't documented] → docs/worktrees.md says to check `git log -1` in a new worktree before starting, and to push main first.
- [The first session in a new worktree waits about 15 s (Nix shell plus install)] → once per worktree. Later sessions find the cache and the packages.
- [The hook scripts that run are the main checkout's version] → a branch that changes them is only exercised after merge. Their tests run on the branch.
- [`merge=union` can keep two versions of an edited line] → CHANGELOG edits are almost always added lines, and the release reads the section before tagging.

## Migration Plan

1. Phase 0 (design decision 9).
2. Merge this change's PR. From then on, new sessions run the hook. Sessions already open don't, until they restart.
3. After the merge, open one worktree session (desktop app or `claude --worktree parallel-check`) and check:
   - the first line;
   - a refused `post_list`;
   - `node --version` printing 26, while `command -v sed xcrun` print the system's;
   - `bin/shorts-studio doctor` showing the sandbox's folders and dead ports. That is safe there: fake keys and `USER=shorts-sandbox`.

   Then `/compact` and check the line comes back, and remove the worktree.
4. Rollback: revert the PR. Then delete what was left behind:
   - any `.sandbox/` folders in worktrees (ignored by git);
   - in the common git folder, `shorts-devshell-path` and `shorts-sessions/`;
   - in each worktree's git folder, `shorts-installed-lock`.

## Open Questions

- Should `worktree.baseRef` stay `fresh` (branch from the remote's main, so PRs carry only their own commits) or become `head` (a worktree also gets unpushed commits on local main)? It applies only to `claude --worktree` and subagents, not to the desktop app's sessions. This design keeps `fresh` and says to push main before opening a lane. Changing it later touches one settings line and one docs sentence.
