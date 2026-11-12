## Context

The findings come from running the CLI and the MCP server as an agent would, in a scratch data folder, on 2026-11-08 and 2026-11-09. What the code does today:

- `reserve` (`packages/usecases/src/ledger.ts`) is the one place every paid call passes before it's sent. It checks the per-post, monthly and daily caps under the ledger lock. Dry runs never reach it, so they can't say whether they'd fit.
- `ctx.settingsIssues` (`context.ts`, filled in `providers/src/node.ts`) already lists what couldn't be used in `config.json`, `brand.json` and the `SHORTS_*` variables. Only `doctor` reads it.
- `needs-confirmation` is raised by the CLI when `--yes` is missing (`apps/cli/src/cli.ts`). It's also raised for the user's approval by:
  - `requireUser` (`inputs.ts`);
  - `image generate` on an unapproved script;
  - `capcut export` on an unapproved draft, and on a draft that changed after approval;
  - `post finalize` before approval.
- Every result with `next` gets it from `nextStep(post)` (`operations/post.ts`), which returns CLI text.
- `requireUser` checks `ctx.interactive`, which is `process.stdin.isTTY`.
- `toolInputSchema` (`operation.ts`) builds each tool's input as a plain `Schema.Struct`. Effect's toolkit decodes the arguments with its default, which drops unknown keys.
- `config show` already returns every check as data (`checks`, each with `status` and `fix`) without failing.

## Goals / Non-Goals

**Goals:**

- An agent never spends past caps it can't read, and learns that from a dry run, not from a failed real run.
- An agent can tell its own next step from the user's from the error code and from `nextSteps`, without parsing prose.
- Nothing an agent mistypes is silently dropped from an MCP call.

**Non-Goals:**

- Making approvals proof against an agent that sets out to get past them. The marker check stops accidents and well-behaved agents. The deny rules in `.claude/settings.json` and `.codex/rules` stay.
- Changing how `next` reads for people.

## Decisions

### One cap check for dry runs and reservations

`reserve`'s checks move into `checkCaps(ctx, entries, call)`. It returns whether the call fits, what's left today, this month and on the post, and when it doesn't fit, the cap that stops it with its message and fix. `reserve` calls it under the lock and fails as today. Each spending operation calls it on its dry-run path, reading the ledger without the lock, and adds a `budget` field to its result.

That's a snapshot: another command could spend in between. That's fine, since the real run checks again under the lock.

Alternative: price the dry run against `budget show`'s totals in each operation. Rejected, because the dry run and the real run could then disagree about the same call.

### Invalid settings stop spending, in the same check

`checkCaps` reports "doesn't fit" whenever `ctx.settingsIssues` isn't empty, naming the first issue. `reserve` turns that into a failure with code `failed` and a fix naming `doctor`, before anything is reserved. Because the check is shared, a dry run says the same.

The CLI prints each settings issue to stderr before any command runs, so `budget show` and the rest still work but say why their caps may be the defaults.

Alternatives:

- Code `over-budget`, exit 4. The make-shorts skill already says to stop and ask the user on that code. Rejected, because no cap was passed, and the fix is to repair a file, not to wait.
- Read `config.json` value by value. That's a bigger change, left out by the proposal.

### `needs-approval`, exit 3

A new reason, `NeedsApproval`, carries the code `needs-approval`, and `exitCodeOf` maps it to 3 next to `needs-confirmation`. Every refusal that waits on the user uses it: `requireUser`, `image generate` on an unapproved script, `capcut export` and `post finalize` on an unapproved draft. `capcut export` on a draft that changed after approval becomes `stale`, because the agent fixes that one itself, with `draft render`.

Alternative: exit 5. Rejected, because exit 3 is documented as "needs `--yes` or the user's approval" and scripts already branch on it. The code tells the two apart.

### `nextSteps` beside `next`

```ts
type NextStep = {
	by: "agent" | "user";
	or?: boolean; // replaces the step before: "source import …, or: script set …"
	cli?: string; // "image generate --post <slug> --dry-run"
	tool?: string; // "image_generate"
	args?: Record<string, unknown>; // { post: <slug>, dryRun: true }
	fill?: string[]; // the args whose value is a placeholder, such as "<final.mp4>"
	note?: string; // "watch draft.mp4 first"
};
```

`nextStepsOf(post)` returns the list. `next` is built from it (each step's `cli` or `note`, joined with ", then:", or ", or:" before a step marked `or`), so the text keeps reading much as it does today.

A shared `nextOf(post)` returns `{ next, nextSteps }`, and each output Schema spreads one `NextFields`. `cli` has no program name, like `next` and every `fix`.

A dry run's next step comes from one helper, `nextAfterDryRun(budget, realRun)`: the real run when the estimate fits, else a step for the user, since the real run would be refused. `image generate` passes it the real run:

- over MCP: `image_generate` without `dryRun`;
- on the CLI: the command with `--yes`.

`post.ts` can't import the operations without an import loop, so steps name tools as strings. A test walks every step `nextStepsOf` can return, for posts at each stage. It checks that each `tool` is an operation on the MCP surface, that each key in `args` is one of that tool's fields, and that `cli` is that operation's command.

Alternative: replace `next` with the structured list and bump `outputVersion` to 2. Rejected for now, because it breaks readers of the string for no gain an added field doesn't give.

### Agent markers

`Context` gains `agentShell: string | undefined`, the marker variable that's set, from a small table in `node.ts` that starts with `CLAUDECODE`. The code and its messages name only the variable, not the agent, to stay brand-neutral. `requireUser` refuses when `agentShell` is set, even with a terminal, and its fix asks the user to run the command in a terminal outside the agent.

Codex's variable isn't added until it's confirmed (see Open Questions).

### Unknown MCP fields

`toolInputSchema` wraps the fields as `Schema.StructWithRest(Schema.Struct(fields), [Schema.Record(otherKey, unknown)])`, where:

- `otherKey` is a string matching none of the declared names (`Schema.isPattern` with a negative lookahead over the escaped names);
- `unknown` is `Schema.Never` with the message "This tool doesn't take this field. It takes: …".

A spike against effect 4.1.2 found:

| Arguments                       | Result                                              |
| ------------------------------- | --------------------------------------------------- |
| `{ post }`                      | decoded                                             |
| `{ post, dryRun: true }`        | decoded                                             |
| `{ post, slugg }`               | fails at `["slugg"]` with that message              |
| `{ post, dry_run: true }`       | fails at `["dry_run"]` with that message            |
| a plain `Record(String, Never)` | rejects the declared fields too, so it isn't usable |

The message reaches the client as Effect reports a bad argument on each protocol: a JSON-RPC `-32602` error on 2025-06-18, a tool result with `isError: true` on 2025-11-25 and 2026-07-28. (Checked against the real server: an earlier probe that reported `-32602` on 2025-11-25 had asked for 2025-06-18.)

Tools with no parameters use the same schema, so they refuse a field too, with "It takes: nothing"; their input still lists as an object.

### `doctor`'s fix

The message keeps one line per blocking problem with its fix. The fix reads: "Fix each problem listed, then run it again. `config show --json` lists every check with its status and fix." It no longer says "the rows above".

### Small things

- **`models` help:** `NOUNS` in `cli.ts` gets an entry for `models`.
- **Slug suggestion:** `readPost`'s `not-found` error lists the slugs once. When exactly one of them is `YYYY-MM-DD-<given>`, the fix names it.

### Found in review, and how they're handled

- **A dry run that won't fit** points at the user, not at a real run that would be refused (`nextAfterDryRun`), and the CLI's `--yes` prompt says to check the budget first.
- **A batch dry run** passes what it planned for earlier posts (`RunMode.plannedUsd`), and each post's budget counts it toward the day and the month.
- **Arguments in `cli`** are quoted when the shell would split them. **Placeholders** (`<final.mp4>`, `<platform>`) are listed in `fill`, and no step holds a value a tool can't take.
- **Settings are refused up front** (`settingsRefusal`) in `image generate` before `--reroll` saves seeds, and in `source transcribe` before any file is tried. A call of $0 always fits.
- **An MCP server reads the settings when it starts**, so the refusal's fix says to restart it after fixing them. Re-reading them per call would change which providers a running server uses, so it's left out.

## Risks / Trade-offs

- **A terminal the user starts from inside an agent session carries `CLAUDECODE`.** For example, Claude Code's `!` commands, or a terminal panel that inherits it. Approvals there would be refused. Mitigation: the fix says why and to use a terminal outside the agent. Checked on 2026-11-09: the Claude desktop app's terminal panel doesn't set `CLAUDECODE` (it sets `CLAUDE_AGENT_SDK_VERSION`, which isn't a marker) and gives stdin a terminal, so approvals work there. Only shells Claude Code itself runs, such as its `!` commands, carry the marker.
- **The code change to `needs-approval` is breaking for scripts that match `needs-confirmation` on approval refusals.** Mitigation: the exit code stays 3, the CHANGELOG marks it **BREAKING**, and the make-shorts skill is updated in the same change.
- **`tools/list` still shows `additionalProperties: true`,** because Effect can't express the key pattern in JSON Schema there. So a client sees no hint until it calls. Mitigation: the error lists the fields the tool takes.
- **A dry run's `budget` is a snapshot without the lock.** It can say "fits" just before another command spends. The real run checks again under the lock, so the caps still hold.
- **Refusing to spend on any settings issue also blocks spending when only `brand.json` is wrong.** That's intended: images made with the wrong brand style are money wasted too. The fix names the file.

## Open Questions

- Which environment variable Codex sets in every one of its modes, if any, so it can join the marker table. Until then, Codex relies on its prefix rules and the terminal check.
