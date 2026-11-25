---

name: verify
description: Use a shorts-studio change the way a user or an agent would before it is committed or goes into a pull request - run the CLI commands and MCP tools it touches in a sandbox with fake keys and scratch posts, look at the pictures and video it makes - and write the proof as the PR's `## Verification` section. Use this skill before committing or opening or updating a PR that touches apps/, packages/ or a skill's commands, and whenever asked to verify, try, check or prove a change works ("verify this", "try it as a user", "does it really work"), even when the request doesn't say "verify". Not for debugging while building, and never against the user's real posts, keys or Keychain.
compatibility: Needs the repository's nix develop shell (Node 26, FFmpeg with libass).
---

# Verify a change before its commit or pull request

Tests and types pass on changes that still fail when used. Run what changed the way a person or an agent would, and leave the proof: each step, what you saw, and whether it passed. The `pr` skill puts the result in the PR body. For a commit without a PR, tell the user the result before showing the commit preview.

## Gotchas

- **Never unset a key to test "missing key".** The CLI then falls back to the user's real Keychain key. Set `USER` to an account that doesn't exist as well.
- **Commands that record the user's decision are theirs.** Every operation that calls `requireUser` (`grep -rn "requireUser(" packages/usecases/src/operations`) refuses in an agent's shell. Never work around that with a pseudo-terminal. Build the state in memory (step 3) or mark the step `not walked: needs the user`.
- **A paid provider without a dead port isn't safe to call.** `doctor` must show a `SHORTS_<ID>_URL … 127.0.0.1:9` warning for every paid provider the change touches. If one is missing, the provider has no `PaidService` id or no URL override: fix the provider, or leave its step `not walked`.
- **Anything that writes outside `$SANDBOX`** (a cache folder, a vault, a download) must be pointed into it first, or its step is `not walked`.

## 1. Which flows

List what the branch changes: `git diff --name-only origin/main...` plus `git status --short`. Walk every flow the paths name, and also what the change adds that no flow describes yet.

| Changed path                                     | Flow       | Walk                                                                                                                                                                                |
| ------------------------------------------------ | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/usecases/src/operations/`, `apps/cli/` | `cli`      | The command's `--help`, then the command on a sandbox post, with and without `--json`. Check the output, the [exit code](../../../docs/architecture.md#exit-codes) and `nextSteps`. |
| `packages/usecases/src/operations/`, `apps/mcp/` | `mcp`      | `tools/list` shows the tool and its schema; `tools/call` on a sandbox post gives what the CLI's `--json` gives.                                                                     |
| `packages/providers/`                            | `provider` | The command that uses it with `--dry-run`, then for real against the dead port: it fails with the error and `fix` it should, and spends nothing.                                    |
| `packages/domain/`, render code                  | `render`   | `beat plan` and `draft render` on a sandbox post; extract frames and look at them.                                                                                                  |
| A schema (`post.json`, config, brand)            | `schema`   | `pnpm schemas` leaves nothing uncommitted; `schema show` prints the new field.                                                                                                      |
| `.agents/skills/` naming commands or flags       | `skill`    | Every command and flag the skill names exists in `--help` today.                                                                                                                    |
| Docs, OpenSpec, CI, a refactor no user sees      | none       | Write `No flow: <reason>` and go to step 5.                                                                                                                                         |

A change that adds a kind of output or a command adds its flow to this table in the same PR. A flow that takes more than a few lines goes in `references/<flow>.md`, and its row says when to read it.

## 2. Set up the sandbox

From the repository root, inside `nix develop`:

```bash
. .agents/skills/verify/scripts/sandbox.sh      # scratch folders, fake keys, dead provider ports
.agents/skills/verify/scripts/sample-media.sh   # tone, click track, test video and image in $SANDBOX/media
bin/shorts-studio doctor
```

`sandbox.sh` reads the providers from the code, so it covers a new one without edits. Run every command of the walk in that same shell. Use only the sample media, never the user's files; a flow that needs another kind of file adds it to `sample-media.sh`.

## 3. Walk each flow

For each step: do it, look, and write down what you saw, not what you expected.

- **CLI:** keep the command, the exit code and the part of the output that proves the step, never a whole JSON body.
- **MCP:** start `bin/shorts-studio mcp serve` in the sandbox's shell and send JSON-RPC lines on stdin: `initialize`, `notifications/initialized`, `tools/list`, `tools/call`.
- **Spending commands:** `--dry-run` first and show the estimate; the real run only against the dead port.
- **States past the user's decision:** build the post in memory with `packages/usecases/src/test/{context,posts,fakes}.ts`, from a scratch `.ts` in `$SANDBOX` run with `node`.
- **Pictures and video:** look at every picture the change makes. For a video, extract a frame per beat (`ffmpeg -ss <t> -i draft.mp4 -frames:v 1 frame-<n>.png`) and check that the text is placed and readable, nothing is cut off, and the motion is the one expected. Pictures stay in `$SANDBOX`, never in a commit.
- **The change's own path** too: the new flag, the fixed case, the error that now says something else.

## 4. When a step fails

1. Read the error and its `fix`, fix the cause, and walk the flow again from its first step.
2. Count the rounds of fixing for the same failing step.
3. **After three rounds that don't make it pass, stop.** Tell the user the flow and step, what you saw, the three things you tried, and the output. Don't commit or open the PR, and don't write the step as passed.

A step that can't be walked here is `not walked`, with the reason. It is never `pass`.

## 5. Write `## Verification`

The `pr` skill puts this section in the PR body as it is, in place of its own `## Verification`.

```markdown
## Verification

| Flow | Walked on          | Result |
| ---- | ------------------ | ------ |
| cli  | sandbox, fake keys | pass   |
| mcp  | sandbox, mcp serve | pass   |

### cli

- `post show --post demo --json` on a post with a transcript → exit 0, `next.cli` is `beat plan --post demo`. pass
- `image generate --post demo --dry-run` → estimate 0.12 USD, no `budget.stoppedBy`. pass

### mcp

- `tools/call post_show {"post":"demo"}` → the same `next` as the CLI. pass

### Checks

- `pnpm check`, `pnpm check-types`, `pnpm test` and `pnpm check-links`, on the branch rebased on `main`.
```

- **One table row per flow walked.** `Walked on`: `sandbox, fake keys`, `sandbox, mcp serve`, or `in memory, test helpers`. `Result`: `pass`, `fail` or `not walked`.
- **One `### <flow>` per row,** one line per step: what you did → what you saw, then `pass`, `fail` or `not walked: <reason>`.
- **`### Checks`** always last: only the commands you ran.
- **With no flow:** `No flow: <reason>` under the heading, then `### Checks`.
- **No user content and no brand names** ([rules 2 and 3](../../../AGENTS.md#rules)): use slugs like `demo`.

## 6. Leave nothing running

Stop any `mcp serve` you started (`pkill -f 'shorts-studio mcp serve'`), check with `pgrep -f`, and delete `$SANDBOX`.
