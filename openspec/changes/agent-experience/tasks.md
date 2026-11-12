## 1. Approvals

- [x] 1.1 Add the `NeedsApproval` reason with code `needs-approval` and exit 3 in `packages/domain/src/errors.ts`; verify `errors.test.ts` covers its code and exit code
- [x] 1.2 Use `needs-approval` in `requireUser`, `image generate` on an unapproved script, and `capcut export` and `post finalize` on an unapproved draft; make `capcut export` on a draft changed after approval fail with `stale`; verify the script, image, capcut and lifecycle tests expect the new codes
- [x] 1.3 Add `agentShell` to `Context`, set in `providers/src/node.ts` from a table holding `CLAUDECODE`, and make `requireUser` refuse when it's set, with a fix that names a terminal outside the agent; verify a test where a terminal plus the marker leaves the script unapproved, and a `node.test.ts` case reading the variable

## 2. Spending

- [x] 2.1 Move the cap checks out of `reserve` into `checkCaps` in `ledger.ts`, returning fit, what's left today, this month and on the post, and the cap that stops the call; verify the existing ledger tests pass unchanged and new ones cover each cap
- [x] 2.2 Make `checkCaps` report "doesn't fit" while `ctx.settingsIssues` isn't empty, and `reserve` fail with code `failed` and a fix naming `doctor`; verify a test where nothing is reserved or sent with a bad setting next to lowered caps
- [x] 2.3 Add a `budget` field to the dry-run results of `image generate`, `audio transcribe` and `source transcribe`; verify a dry run over today's cap says it doesn't fit, names `caps.dailyUsd` and exits 0
- [x] 2.4 Reword `capFix` so it says where waiting helps and that raising a cap is the user's decision; verify the "every cap would be passed" test checks both
- [x] 2.5 Print each settings issue to stderr before a CLI command runs; verify a `cli.test.ts` case where `budget show` runs and stderr names config.json

## 3. Next steps

- [x] 3.1 Add `NextStep`, `nextStepsOf(post)` and `nextOf(post)` in `operations/post.ts`, build `next` from the steps, and point images at `--dry-run`; verify the existing `next` tests still pass, with the image step changed
- [x] 3.2 Spread `NextFields` into every output that has `next`, and make `image generate`'s dry run return the real run as its next step (the tool without `dryRun`, the CLI with `--yes`); verify a test for each spec scenario under "Every post SHALL name its next step"
- [x] 3.3 Add a test that walks `nextStepsOf` for a post at each stage and checks each step's tool is on the MCP surface, its `args` keys are that tool's fields, and its `cli` is that operation's command

## 4. MCP

- [x] 4.1 Make `toolInputSchema` refuse fields a tool doesn't take, as in design.md, with a message listing the fields; verify an MCP test on every protocol version where `image_generate` with `dry_run: true` fails, names `dry_run`, and submits nothing, and the parity test still passes

## 5. Small things

- [x] 5.1 Reword `config check`'s fix to name `config show --json` and drop "the rows above"; verify a test of the fix
- [x] 5.2 Add `models` to `NOUNS` in `cli.ts`, and make `readPost`'s `not-found` fix name the one post whose slug is the given slug with a date in front; verify a `post-store` test with one match and one with two

## 6. Docs and skill

- [x] 6.1 Update `docs/architecture.md` (the exit codes table, `nextSteps`, `budget`, unknown MCP fields), `CHANGELOG.md` (the code change marked **BREAKING**), and make-shorts' "When something fails" in `.agents/skills/`, then run `pnpm skills:sync`; verify with `pnpm check-links`
- [x] 6.2 Ask the user to run `echo $CLAUDECODE` in the terminal they approve from (including the Claude desktop app's terminal panel, if they use it) and record the answer under Risks in design.md; if it's set there, stop and settle with the user how approvals stay possible before shipping

## 7. Check

- [x] 7.1 Run `pnpm check && pnpm check-types && pnpm test && pnpm check-links`, `pnpm schemas`, and `openspec validate --all --strict`; all pass with no schema diff left over
- [x] 7.2 In a scratch data folder, run the real CLI and a fresh `mcp serve`, and check each of these:
  - a bad setting next to lowered caps refuses `audio transcribe` and warns on `budget show`;
  - a dry run reports its `budget`;
  - `image generate --yes` on an unapproved post fails with `needs-approval`;
  - `post show` returns `nextSteps`;
  - `image_generate` with `dry_run` fails, naming the field.

## 8. Review fixes

- [x] 8.1 After a dry run that won't fit, make the next step the user's (`nextAfterDryRun`, shared by `image generate` and `audio transcribe`), and say to check the budget in the CLI's `--yes` prompt; verify the post and audio tests
- [x] 8.2 Count a batch dry run's earlier posts in each post's budget (`RunMode.plannedUsd`), and let a $0 call fit; verify the CLI batch test and the ledger tests
- [x] 8.3 Quote `cli` arguments the shell would split, and list placeholders in `fill`; verify the quoting test and the stage walk
- [x] 8.4 Refuse on settings before `--reroll` saves seeds and before `source transcribe` tries a file, and tell an MCP server to restart after the fix; verify the image and source tests
- [x] 8.5 Make tools with no parameters refuse fields too; verify the MCP test on every version
- [x] 8.6 Switch review-page, carousel and voice-music-animate to `needs-approval`, share `DATED`, name `SHOWS_SETTINGS` from the operations, and keep product names out of the code; verify `openspec validate --all --strict` and `pnpm check`
