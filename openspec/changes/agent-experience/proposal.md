# Agent experience

## Why

A review of how an agent drives the CLI and the MCP server found places where the rules the core sets aren't kept at the edges. Some of them can cost money or take a decision away from the user:

- An invalid `config.json` silently puts the caps back to their defaults, which can be higher than the user's.
- One error code means both "run it again with `--yes`" and "stop, this is the user's decision".
- `next` is CLI text even over MCP, and it sends an agent straight to `image generate --yes`, skipping the dry run.
- An agent with a pseudo-terminal gets past the approval check.

## What Changes

- **Spending refuses while the settings aren't valid.** When `config.json`, `brand.json` or a `SHORTS_*` variable can't be used, a paid call fails before it reserves anything: its caps aren't known. Other commands still run and warn on stderr.
- **A dry run says whether it fits the caps.** Its result holds what's left today, this month and on the post, and whether the estimate fits; if it doesn't, it says which cap stops it.
- **The over-budget fix leaves raising a cap to the user.** It says to wait where waiting helps, and that raising a cap is the user's decision, instead of telling the reader to raise it.
- **A code for the user's decisions.** A step that waits on the user's approval fails with the new code `needs-approval` (still exit 3). `needs-confirmation` keeps meaning "check the estimate, then run it again with `--yes`". **BREAKING** for scripts that match the old code on these refusals. A CapCut export that no longer matches the approved draft fails with `stale`.
- **Next steps an agent can call.** Every result that has `next` also has `nextSteps`: each step's MCP tool and arguments, its CLI command, and whether it's the agent's or the user's. `next` stays as text. Images point at a dry run first, and a dry run's next step is the real run.
- **Approvals refuse an agent's shell.** `script approve` and `post review` also refuse when a known agent marker is set (Claude Code sets `CLAUDECODE`), even with a terminal.
- **MCP tools refuse unknown fields.** A misspelt field, such as `dry_run` for `dryRun`, fails and names the fields the tool takes, instead of being dropped.
- **`doctor` points at its rows as data.** Its fix names `config show --json`, which lists every check with its status and fix, instead of "the rows above".
- **Small things.** `--help` describes `models`. A post not found by a slug that matches one post's slug without its date suggests that slug.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agent-interface`: exit codes, next steps, the setup check, approvals in an agent's shell, and unknown MCP fields.
- `spend-budget`: refusing to spend while settings aren't valid, dry runs that say whether they fit, the over-budget fix, and the approval code for images.
- `post-manifest`: the code for finalizing before approval.
- `media-pipeline`: the code for a CapCut export that no longer matches the approved draft.

## Impact

- `packages/domain/src/errors.ts`: the `needs-approval` code.
- `packages/usecases`: `ledger.ts` (one cap check for dry runs and reservations), `inputs.ts`, `context.ts`, `post-store.ts`, `operation.ts`, and the operations that return `next` or refuse for approval.
- `packages/providers/src/node.ts`: the agent marker in the `Context`.
- `apps/cli/src/cli.ts` (help text, warnings on stderr), `apps/mcp/src/mcp.ts` via `toolInputSchema`.
- `schemas/`, `docs/architecture.md`, `CHANGELOG.md`, and the make-shorts skill's "When something fails".

Not part of this change:

- A structured `fix`: it stays text.
- Bumping `outputVersion`: `nextSteps` is added beside `next`, not in its place.
- Reading `config.json` value by value, so one bad value keeps the rest.
- Returning bad MCP arguments as a tool error on 2025-06-18, which answers them with a JSON-RPC error: Effect decides that per protocol version.
- Making `tools/list` publish `additionalProperties: false`.
- A `SHORTS_JSON` variable.
- Passing a script or beats inline instead of as a file.
- Asking the user to type the slug to approve.
