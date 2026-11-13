## 1. Provider failures and the ledger

- [ ] 1.1 Add the `NotSent` reason (code `provider`) to `packages/domain/src/errors.ts` and to `NOTHING_BILLED` in `ledger.ts`; verify `errors.test.ts` maps it to `provider` and exit 1, and a `ledger.test.ts` case where a `NotSent` failure inside `paidCall` leaves today's total unchanged
- [ ] 1.2 Sort failures in `providers/src/env.ts` as in design.md (`InvalidUrlError`, `EncodeError`, the not-sent codes, an `AggregateError` only when every error in it is listed); verify `env.test.ts` has one case per listed code giving `NotSent`, `ECONNRESET`, `UND_ERR_SOCKET` and a timeout giving `ProviderFailed`, and the existing ECONNREFUSED case updated to a cause with `code: "ECONNREFUSED"`
- [ ] 1.3 Build each kind's fix in `env.ts` from the provider's name and key (not sent, refused by status, unknown, ended), and use it in `together.ts` and `fal.ts`; verify the image-maker and transcriber contracts gain "a service that can't be reached gives `NotSent`" against a local port that was just closed, and `fal.test.ts` and `together.test.ts` check each fix's first sentence for 401, 429, 502 and a refused connection
- [ ] 1.4 Add "running it again pays for a new one" to `image.ts`'s submit-deadline fix, and stop `source transcribe` at the first `NotSent` as at `over-budget`; verify an `image.test.ts` deadline case and a `source-download.test.ts` case where two files and a dead transcriber give one attempt and today's total unchanged
- [ ] 1.5 Update the Ledger section of `docs/architecture.md` (what `nothingBilled` frees) and add a CHANGELOG entry; verify `pnpm check-links`

## 2. Images: one run per post, resumes first, rerolls and imports

- [ ] 2.1 Hold `images.lock` in the post's folder for `image generate`'s whole real run, and for `image import`'s write, through `withLock` with the usual wait; verify an `image.test.ts` case where two runs on one post with a slow fake maker give one submit per beat and the second fails with `conflict` naming the first's command, and a dry run that takes no lock
- [ ] 2.2 Inside the lock, read the post again, then fetch every beat with a saved request in its own pass before reserving any new one; verify a test whose fake maker records calls: beat 3's `collect` comes before any `submit`
- [ ] 2.3 Make `--reroll` refuse a chosen beat with `pending` with `conflict` before sending anything, stop writing seeds up front, and save the new seed in the same `updatePost` as `pending`; verify tests for "A reroll over a saved request" and "A reroll over the cap" (seed unchanged, and the next dry run plans the same seed)
- [ ] 2.4 Set `image_generate`'s `hints.idempotent` to `false`; verify an `mcp.test.ts` case reading `idempotentHint: false` from `tools/list`
- [ ] 2.5 On `over-budget`, read the post again and add the saved and the still-pending beats to the message, and the free fetch (`image generate --post <slug> --beat <n,…>`) to the fix; verify a test for "A saved request left behind"
- [ ] 2.6 Make `image import` refuse a beat with `pending`, with `conflict` and a fix naming the free fetch; verify an `image-import.test.ts` case where the saved request is still there afterwards
- [ ] 2.7 Update the Images steps in `docs/architecture.md` (one run per post, saved requests first, rerolls) and add CHANGELOG entries; verify `pnpm check-links`

## 3. Interrupted runs

- [ ] 3.1 Add the `Interrupted` reason with code `interrupted`, and map it to 130 in `exitCodeOf`; verify `errors.test.ts` and that `pnpm schemas` adds the code wherever `ErrorCode` is published
- [ ] 3.2 In `leaf` (`apps/cli/src/cli.ts`), print an interrupted run's outcome from `Effect.onInterrupt`: one envelope with `--json`, the error on stderr as text, with a fix that names the command and, for a spending command, says saved requests are fetched free and to leave out `--reroll`; verify a `cli.test.ts` case interrupting a slow fake operation with `--json`: stdout parses as one object with code `interrupted`, and the run exits 130
- [ ] 3.3 Run `generateOne`'s reserve, send and save in a child fiber, joined under `Effect.onInterrupt`, which logs the 60-second wait and then awaits the child (check `Effect.forkChild`, `Fiber.join` and `Fiber.await` in the installed `.d.ts`); verify an `image.test.ts` case interrupting during a slow fake submit: stderr names the beat and the wait, and `post.json` holds the request afterwards
- [ ] 3.4 Add `interrupted` to the exit codes table and the agent interface section of `docs/architecture.md`, and a CHANGELOG entry; verify `pnpm check-links`

## 4. Dry runs and --yes

- [ ] 4.1 Add `fix` and the `stoppedBy` value `missing-key` to `Budget`, and let `budgetFor` take the keys the real run would use, checking settings (above $0), then keys (by presence, even at $0), then caps; verify `ledger.test.ts` cases for each order and for a $0 fetch with a missing key
- [ ] 4.2 Pass the keys from the dry runs of `image generate`, `audio transcribe` and `source transcribe`, and refuse on settings up front only when something would be paid for, and on keys only when something would be sent or fetched; verify the "A dry run without the key" scenario and a test where a run that only fetches saved requests succeeds next to a broken setting
- [ ] 4.3 Make `nextAfterDryRun` pick its steps by `stoppedBy` and add the free-fetch step when chosen beats have saved requests, as in design.md; verify a test for each scenario of "A dry run that can't go ahead SHALL say who clears the way", and that the stage-walk test still finds every step's tool, `args` and `cli` valid
- [ ] 4.4 In `attempt` (`cli.ts`), after the dry run that stands in for a missing `--yes`: fail with what stops it when `budget.fits` is false, run for real when the estimate is $0, else `needs-confirmation`; verify `cli.test.ts` cases for "Without --yes, over a cap" (exit 4), "Only saved requests to fetch" (exit 0, images saved) and "Without --yes" (exit 3)
- [ ] 4.5 Update make-shorts' "When something fails" in `.agents/skills/` (a dry run's `stoppedBy`, the free fetch, and the new codes without `--yes`) and run `pnpm skills:sync`; update `docs/architecture.md`, run `pnpm schemas`, and mark the `--yes` change **BREAKING** in CHANGELOG; verify `pnpm check-links` and no schema diff left over

## 5. Settings

- [ ] 5.1 Make `settingsIssues` a list of `{ source, risk, text }` (`context.ts`, `node.ts`), and update `settingsRefusal`, `settingsChecks` and `warnSettings`; verify the existing `node.test.ts`, config and CLI tests pass with the new shape
- [ ] 5.2 Report unknown keys in config.json and brand.json from a second decode with `onExcessProperty: "error"`, keeping only `UnexpectedKey` issues, each naming the closest setting from a shared `closest(name, candidates)`; verify `node.test.ts` cases: `caps.daily` names `caps.dailyUsd` with risk `caps` while `caps.postUsd` still applies, and an unknown brand.json key has risk `brand`
- [ ] 5.3 Report every `SHORTS_*` variable that names no setting, except `SHORTS_DATA_DIR`, `SHORTS_POSTS_DIR`, `SHORTS_<PROVIDER>_URL`, `SHORTS_INSTALL_DIR` and `SHORTS_VERSION`; verify `node.test.ts` cases for `SHORTS_CAPS_DAILY`, a `SHORTS_MODELS_*` variable, and the exempt names
- [ ] 5.4 Add `capsFrom` to `Context`, and return `capsFrom` and `settingsIssues` from `budget show` and `settingsIssues` from `models list`; verify `budget.test.ts` and `models.test.ts` cases for the "Spending SHALL be easy to see" scenarios, and an `mcp.test.ts` case for `budget_show`
- [ ] 5.5 Word `settingsRefusal` by the first issue's risk, name `doctor` with `config_check`, and make `capFix` name where its cap was set; verify `ledger.test.ts` cases for "A broken brand.json", "A misspelt cap" and "A cap set by a variable"
- [ ] 5.6 Add the MCP restart sentence to every settings and key row's fix in `config check`, and the Keychain note on macOS; verify a `config.test.ts` case
- [ ] 5.7 Update the settings paragraphs of `docs/architecture.md` and `docs/getting-started.md`, run `pnpm schemas`, and mark unknown keys stopping spending **BREAKING** in CHANGELOG; verify `pnpm check-links` and no schema diff left over

## 6. doctor

- [ ] 6.1 Add blocking rows for the data folder, the posts folder and the ledger to `runChecks`; verify `config.test.ts` cases for "The posts folder is a file" (naming `SHORTS_POSTS_DIR`) and "A corrupt ledger"
- [ ] 6.2 Add `code` to `Check` and `CheckRow`, set per row as in design.md, and print it beside each problem; verify a `config.test.ts` case for "A missing key" in both `config show --json` and `doctor`'s message, and `pnpm schemas`
- [ ] 6.3 Reword the corrupt-ledger fix: the user's decision for a line in the middle, remove an unfinished last line; verify the two "The ledger SHALL be read strictly" scenarios in `ledger.test.ts`
- [ ] 6.4 Add a CHANGELOG entry for the new rows and codes; verify `pnpm check-links`

## 7. Locks

- [ ] 7.1 Add `processStartedAt(pid)` to `Context`, from `ps -o etime= -p <pid>` through `runProcess` in `node.ts`, undefined on Windows or when `ps` fails; verify a `node.test.ts` case with a child process started during the test, and one with a pid that doesn't exist
- [ ] 7.2 Let `withLock` take that probe and take over a lock whose live holder started after the lock's `since` plus a minute; pass it from the post store and the ledger; verify `files.test.ts` cases with a fake probe for "A process number used again", and one where the holder started before `since`
- [ ] 7.3 Make `busyPost` and the ledger's busy error name the holder, the lock file and when the file is left over; verify `post-store.test.ts` and `ledger.test.ts` cases for "The ledger is busy", and a CHANGELOG entry

## 8. Amounts

- [ ] 8.1 Add `money.ts` (`usd`, `usdOf`, `roundUsd`) to `usecases`; verify `money.test.ts` with $0, $0.0003, $0.012, $0.07215, $2, and the pairs ($0.003, $0.004) and ($0.005, $0.01)
- [ ] 8.2 Use them for every money string in `ledger.ts`, `budget.ts`, `image.ts`, `audio.ts`, `source-download.ts` and `config.ts`, and round every dollar amount in a result; verify the three "Amounts SHALL be shown so they can be told apart" scenarios, and a CHANGELOG entry

## 9. Check

- [ ] 9.1 Run `pnpm check && pnpm check-types && pnpm test && pnpm check-links`, `pnpm schemas` and `openspec validate --all --strict`; all pass with no schema diff left over, then run the `readability-improver` agent over the changed code
- [ ] 9.2 In a scratch data folder, with `SHORTS_FAL_URL` and `SHORTS_TOGETHER_URL` at `http://127.0.0.1:9`, fake keys and no real provider, seed posts from the test fixtures (an approved script, a beat with a saved request; never by running `script approve`), then run the CLI and a fresh `mcp serve` and check:
  - `audio transcribe` three times fails with `provider`, says nothing was counted, and `budget show` stays at $0;
  - `image generate --beat <saved> --reroll --yes` and `image import` on that beat fail with `conflict`, and the request stays in `post.json`;
  - two `image generate --yes` at once, against the local FAL fake slowed down, give one submit per beat;
  - Ctrl-C during `image generate --yes --json` prints one object with code `interrupted` and exits 130;
  - with `FAL_KEY` unset, `image generate --dry-run` says `missing-key`, and without `--yes` it exits 1 with `missing-key`;
  - `{"caps":{"daily":0.5}}` in config.json, or `SHORTS_CAPS_DAILY=1`, makes `doctor` fail naming the closest setting, refuses `audio transcribe`, and `budget_show` lists it in `settingsIssues`;
  - a broken brand.json refuses `image generate` with the brand wording;
  - `SHORTS_POSTS_DIR` naming a file, and a corrupt ledger line, each make `doctor` fail;
  - a post's lock naming the pid of a `sleep` started after the lock's time is taken over;
  - `caps.dailyUsd` of 0.004 shows amounts that differ in `budget show`;
  - over MCP, `config_check` with a bad setting says to restart the server, and `image_generate` with `dryRun` and no key returns a user step naming `FAL_KEY`.
