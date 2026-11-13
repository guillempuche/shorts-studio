# Spend safety

## Why

A recovery audit (2026-11-12) ran the CLI and the MCP server the way an agent would, against dead provider addresses and fake keys. It found places where shorts-studio counts money it never spent, pays twice, loses images already paid for, or tells the reader something wrong about money:

- A request that never left the machine (connection refused, a name that doesn't resolve) stays counted. Following its fix, "run it again", fills the caps with $0 billed.
- Two `image generate` runs on one post both pay for every beat. `--reroll` drops a request already paid for. `image import` over one drops it too.
- A run stopped by Ctrl-C prints nothing with `--json`, and a dry run says a call fits when the real run would fail on a missing key.
- `{"caps":{"daily":0.5}}` is ignored without a word, so the caps stay at $5 while `doctor` says `Ready.`
- `doctor` passes with a corrupt ledger, and amounts like "$0.01 of $0.01" hide that money is left.

## What Changes

- **A request that never left the machine costs nothing.** When the connection is refused, the name doesn't resolve or the TLS handshake fails, the reservation is freed. The fix says the provider can't be reached, nothing was counted, and to tell the user.
- **Every provider failure says whether it was counted.** Its fix says whether the cost stays counted and what running it again does. The code stays `provider`.
- **One run at a time makes a post's images.** A second `image generate` on the same post waits, then fails with `conflict` naming the first.
- **No command drops a paid request.** `--reroll` and `image import` refuse a beat whose request is saved but not fetched, and say how to fetch it at no cost. A reroll saves its new seed only with its new request, after the caps check. Saved requests are fetched before any new one is sent.
- **A run stopped by a cap says what it saved** and which beats are paid for but not fetched, and how to fetch them free.
- **An interrupted run prints its error object.** With `--json`, Ctrl-C prints one object with the new code `interrupted` (exit 130) and a fix that says how to resume. Ctrl-C while a request is being sent says it waits up to 60 s to save it.
- **Dry runs check the keys** and say who clears what stops them: the user for a cap or a key, the user then `config_check` for settings.
- **The CLI asks for `--yes` only when the run could go ahead.** **BREAKING** for scripts: without `--yes`, a run that doesn't fit now fails with `over-budget` (exit 4), `missing-key` or `failed` (exit 1) instead of `needs-confirmation` (exit 3), and a run of $0 (fetching saved requests) runs without `--yes`.
- **Unknown settings are problems.** **BREAKING** for setups with stray keys: a key in `config.json` or `brand.json`, or a `SHORTS_*` variable, that names no setting is reported with the closest setting, and spending stops until it's fixed, like any setting that can't be used.
- **Settings say where they come from.** `budget show` names where each cap was set and lists the settings that can't be used; `models list` lists them too. The over-budget fix names where its cap was set. A settings refusal says what's at risk: the caps, the brand's style, or one setting.
- **Fixes say when the MCP server needs a restart.**
- **`doctor` checks the folders and the ledger,** and each problem carries its own code.
- **Locks** name their file, and a lock whose process number now belongs to another program is taken over.
- **Amounts can be told apart:** no "$0.00 of $0.00" for a sub-cent cap, no float noise in JSON.

Not part of this change:

- Letting beats already started finish after a failure. The open change parallel-stories plans it (task 1.6, "A failed request SHALL stop new ones for its post").
- `nextSteps` on errors, fixes reworded for an MCP-only agent, and the batch error's code: the agent-recovery change.
- Next steps that follow a post's state, such as a beat with a saved request counting as not done: the state-aware-steps change.
- Changing `doctor`'s own error code. "The setup check SHALL fail with the fixes" stays as the renderer-text-layers change leaves it.
- New error codes for the kinds of provider failure, and a structured field saying whether a failure was counted.
- Re-reading the settings inside a running MCP server.
- Checking a whole run's total against the caps before its first request.
- Telling a reused process number apart on Windows.
- Bumping `outputVersion`: every field and code this change adds is new, not a change to one.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `spend-budget`: freeing requests that never left the machine, one images run per post, rerolls and resumes, dry runs that check keys and say who clears the way, `--yes` only when the run could go ahead, where caps come from, settings refusals, the ledger's fix, and amounts.
- `agent-interface`: the interrupted error object and exit code, unknown settings, settings problems in results, MCP restarts, `doctor`'s folder, ledger and code checks, and locks.
- `media-pipeline`: `image import` over a saved request.

## Impact

- `packages/domain/src/errors.ts`: the `NotSent` and `Interrupted` reasons, the `interrupted` code and exit 130.
- `packages/providers/src/env.ts`, `fal.ts`, `together.ts`: failures sorted into not sent, refused, unknown and ended, each with its fix.
- `packages/providers/src/node.ts`: unknown keys and variables, where each cap comes from, settings issues with what they put at risk, and a process's start time.
- `packages/usecases`: `ledger.ts`, `context.ts`, `files.ts`, `lock.ts`, `post-store.ts`, a money formatter, and the operations `image`, `image-import`, `audio`, `source-download`, `budget`, `models`, `config` and `post` (`nextAfterDryRun`).
- `apps/cli/src/cli.ts`: the interrupted object, and `--yes` only when the run could go ahead.
- `schemas/`, `docs/architecture.md`, `CHANGELOG.md`, and make-shorts' "When something fails".
