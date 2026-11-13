## Context

The findings come from the recovery audit of 2026-11-12, run against dead provider addresses (`http://127.0.0.1:9`) and fake keys in scratch data folders. Line numbers are as of fe43a4723. What the code does today:

- **Provider failures.** `failure` (`packages/providers/src/env.ts:63-74`) turns every failure into `ProviderFailed` (code `provider`), except an HTTP 4xx on a submit, which becomes `Refused`. A `TransportError` whose cause is a refused connection is `ProviderFailed` too. `NOTHING_BILLED` (`packages/usecases/src/ledger.ts:368-376`) frees only `Refused`, `RequestEnded`, `MissingKey`, `Usage` and `NotFound`. So a request that never left the machine stays counted, and the fix (`together.ts:54`, `fal.ts:62`) says "run it again". `Refused`, `RequestEnded` and `ProviderFailed` all have code `provider` (`domain/src/errors.ts`).
- **Images.** `image generate` (`operations/image.ts`) reads the post once (`:261`), plans each beat from that read, and runs `generateOne` three beats at a time (`:344`). `generateOne` decides resume or send from the beat it was given (`:91`); the post's lock is held only for each write. `--reroll` writes new seeds and drops every chosen beat's `pending` (`:295-307`) before any cap is checked. The first failure interrupts the other beats (`Effect.forEach` with `concurrency`). `hints.idempotent` is `true` (`:256`). `image import` drops `pending` too (`image-import.ts:65`).
- **Interrupts.** The CLI prints a run's outcome in one place, after `attempt` (`apps/cli/src/cli.ts:280-287`), and catches only failures. `main.ts:58-62` doesn't report an interrupt. A send runs inside `Effect.uninterruptible` with a 60-second deadline (`image.ts:49, 98`), and says nothing while Ctrl-C waits for it.
- **Dry runs.** `budgetFor` (`ledger.ts:302`) checks settings and caps, not keys. The real run checks keys (`audio.ts:118`, `image.ts:292`, `source-download.ts:232`). `nextAfterDryRun` (`operations/post.ts:230`) gives one user step, "ask the user", whatever stopped it. Without `--yes`, the CLI fails with `needs-confirmation` whatever the dry run found (`cli.ts:175-180, 217`).
- **Settings.** `readSettings` (`providers/src/node.ts:47-69`) decodes each file with Effect's default `onExcessProperty: "ignore"`, and `envOverrides` (`:118-141`) reads only the variables that name a setting. Unknown keys and variables vanish. `ctx.settingsIssues` is a list of strings. `settingsRefusal` (`ledger.ts:218-228`) says "the caps may be the defaults" for any of them, brand.json included. `budget show` and `models list` warn only on stderr (`cli.ts:305-310`). The over-budget fix always names `<data>/config.json` (`ledger.ts:257`).
- **MCP.** `main.ts:24-25` builds the `Context` and the providers once; `mcp serve` keeps both. Keys are looked up per call (`ctx.secret`), so a Keychain entry added later is seen, but a variable exported in another shell never reaches the server.
- **`doctor`.** `runChecks` (`operations/config.ts:61-83`) covers settings, models, tools and keys, not the folders or the ledger. Its failure is always `missing-tool` (`:159-164`). "The setup check SHALL fail with the fixes" fixes that code, and the open change renderer-text-layers modifies that requirement, so it stays.
- **Locks.** `tryLock` (`usecases/src/files.ts`) takes over a lock whose pid is dead or older than the last boot. A pid reused by another program keeps it busy forever. `busyPost` (`lock.ts:33-40`) says "wait"; the ledger's busy message (`ledger.ts:148-152`) names neither holder nor file.
- **Money.** `toFixed(2)` and `toFixed(3)` in `ledger.ts:207, 258-289`, `budget.ts:51-54`, `image.ts:370-371`, `audio.ts:155` and `source-download.ts:279`. JSON totals carry float sums.

## Goals / Non-Goals

**Goals:**

- The ledger never counts a request that never left the machine, and never loses one that did.
- No command pays twice for one beat, or drops an image already paid for.
- An agent learns from a dry run, not a failed real run, whether the real run can go ahead, and whose step comes next.
- A setting the user meant, and shorts-studio ignored, never passes silently.

**Non-Goals:**

- Changing which started beats finish after a failure: parallel-stories (see Overlaps).
- Structured error steps or MCP-only wording for every fix: agent-recovery.

## Decisions

The user confirmed every decision below, as recommended, on 2026-11-13.

### Four kinds of provider failure

A new reason, `NotSent`, joins `Refused`, `RequestEnded` and `ProviderFailed`. All four keep the code `provider`. `NOTHING_BILLED` gains `NotSent`.

`failure` in `env.ts` sorts an `HttpClientError` this way:

| Failure                                                                  | Reason           | Freed |
| ------------------------------------------------------------------------ | ---------------- | ----- |
| `InvalidUrlError`, `EncodeError`                                         | `NotSent`        | yes   |
| `TransportError` whose deepest cause's `code` is on the not-sent list    | `NotSent`        | yes   |
| `StatusCodeError` 4xx on a submit                                        | `Refused`        | yes   |
| A provider's "ended" answer                                              | `RequestEnded`   | yes   |
| Anything else: 5xx, timeouts, resets, a bad reply, any failure on a read | `ProviderFailed` | no    |

The not-sent list is the errors raised before a request's first byte is written: `ECONNREFUSED`, `ENOTFOUND`, `EAI_AGAIN`, `EHOSTUNREACH`, `ENETUNREACH`, `EADDRNOTAVAIL`, `UND_ERR_CONNECT_TIMEOUT`, and the TLS certificate and handshake errors (`CERT_*`, `ERR_TLS_*`, `ERR_SSL_*`, `DEPTH_ZERO_SELF_SIGNED_CERT`, `SELF_SIGNED_CERT_IN_CHAIN`, `UNABLE_TO_VERIFY_LEAF_SIGNATURE`, `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`). `ECONNRESET`, `EPIPE`, `UND_ERR_SOCKET` and timeouts stay unknown: a reused connection can fail after it has written the request. `effect@4.1.2`'s fetch client puts fetch's own error in `TransportError.cause` (`dist/http/FetchHttpClient.js`), and the system error with its `code` sits under that, which `deepestMessage` already walks. When Node tried several addresses, that error is an `AggregateError`; it counts as not sent only when every error in it is on the list.

Each kind has its own fix, built in `env.ts` from the provider's name and key, and starting with one of these sentences:

- not sent: "Nothing was sent, so nothing was counted. <Provider> can't be reached from this machine (<why>). Tell the user: it needs a working connection, without a VPN or firewall blocking it, or a correct `SHORTS_<P>_URL`. Running it again before that fails the same way."
- refused: "<Provider> refused the request, so nothing was counted." Then, by status: 401 or 403, check `<KEY>`; 429, wait a minute; other 4xx, the request itself (the model's options in config.json, or the input). "Running it again unchanged gets the same answer."
- unknown: "The outcome is unknown, so its cost stays counted. Running it again pays for a new request: wait a few minutes first."
- ended: "<Provider> ended the request without a result, so nothing was counted. Running it again sends a new request."

`image.ts` keeps its own fixes for collecting, which resume the saved request for free, and the submit-deadline fix gains "running it again pays for a new one". `source transcribe` stops at the first `NotSent`, as it does at `over-budget`: every later file would fail the same way.

Alternatives:

- A new code, such as `unreachable`. Rejected: scripts that match `provider` would break, and the agent's next move is in the fix either way.
- A field in the error object (`counted: true`). Rejected for now: the error object stays `{ code, message, fix }`, and agent-recovery is adding structured `nextSteps` to errors, which carry who acts next.
- Treat every `TransportError` as not sent. Rejected: a reset after the request was written would free money that was billed.

### One images run per post

`image generate`'s real run holds `images.lock` in the post's folder for its whole run, through `withLock` (`lock.ts`), with the same 10-second wait as the post's lock. Then a second run fails with `conflict` naming the first's process, command and start. `image import` takes the same lock for its one write. Dry runs take no lock. The order is always `images.lock`, then `post.json.lock` or the ledger's, so they can't deadlock.

Inside the lock, the run reads the post again before planning, and plans resumes first: every beat with a saved request is fetched, in its own pass, before any new request is reserved. So a rerun after a cap fetches what's paid for before it hits the cap again.

`hints.idempotent` becomes `false`: with `reroll`, calling the tool twice pays twice, and an MCP client may retry an idempotent tool on its own.

Alternatives:

- Re-read each beat under the post's lock just before reserving. Rejected: the race is between reserving and saving the request, up to 60 s apart, and holding `post.json.lock` that long blocks every other write to the post.
- Fail at once instead of waiting. Rejected: a second run that starts just as the first ends would fail for nothing; 10 s matches every other lock.

### Rerolls and imports never drop a saved request

`--reroll` checks the chosen beats under `images.lock`. A beat with `pending` fails the run with `conflict`, before anything is sent: "Beat N has a request already paid for. Run `image generate --post <slug> --beat N` without `--reroll` first: it fetches that image at no cost. Then reroll it." The reroll no longer writes seeds up front. It plans each chosen beat with `seed + 1`, and `generateOne` writes `seed` in the same `updatePost` that saves `pending`. A reroll refused by a cap, a setting or the provider, or stopped before sending, leaves the seed as it was, and its dry run still plans the same seed.

`image import` refuses a beat with `pending` the same way, naming the free fetch.

Alternatives:

- Resume the saved request, then reroll. Rejected: a reroll interrupted after sending, then run again with `--reroll`, would pay a third time. Refusing makes "run it again without `--reroll`" the one safe path, which is what the interrupted fix says.
- Let `image import` settle the reservation and drop the request. Rejected: the image is paid for; losing it to save one command is the wrong trade.

### A run stopped by a cap

When the run fails with `over-budget`, `image generate` reads the post again and adds to the message which beats it saved and which have `pending`. When any have `pending`, the fix adds: "`image generate --post <slug> --beat <n,…>` fetches the N images already paid for, at no cost." With resumes in their own first pass, that list is usually empty; it's not when the cap stops a beat while another beat's earlier request is still waiting, or under concurrent runs on other posts.

What happens to beats already in flight when one fails belongs to parallel-stories (task 1.6). Its spec says the run then fails "with that first failure's error, unchanged". This change keeps the code and adds to the message and fix, which that change should read as compatible (see Overlaps).

Alternative: check the whole run's total against the caps before the first request, so a cap never stops a run part-way. Left out: it changes what a run that doesn't fit does (no partial work at all), which deserves its own decision, and concurrent runs on other posts can still stop one part-way.

### Interrupted runs

`Interrupted` is a new reason with code `interrupted`; `exitCodeOf` maps it to 130. Only the CLI builds it.

In `leaf` (`cli.ts`), `attempt` gets `Effect.onInterrupt`, whose finalizer prints the outcome as the normal path does: with `--json`, one envelope holding the `interrupted` error; as text, the error on stderr. The runtime still exits 130. The fix names the command (`label`); for a spending command it adds "Requests already sent are saved and fetched without paying again; leave out `--reroll`." A batch prints the same object; reporting the posts that finished belongs to parallel-stories (2.2).

For the 60-second wait, `generateOne` runs its reserve, send and save in a child fiber (`Effect.forkChild` of the uninterruptible block), and waits on it with `Fiber.join` wrapped in `Effect.onInterrupt`. On Ctrl-C the finalizer logs "beat N: waiting up to 60 s for the provider's answer, so the request is saved and not paid for twice", then waits with `Fiber.await`. These APIs are in `effect@4.1.2` (`Effect.forkChild`, `Effect.onInterrupt`, `Fiber.join`, `Fiber.await`); a test checks the child isn't interrupted mid-send. If that proves fragile, the fallback is one stderr line before each send.

Alternative: a SIGINT listener in `main.ts`. Rejected: it can't know whether anything is being sent.

### Dry runs: keys, who clears the way, and `--yes`

`Budget` gains `fix` (when it doesn't fit) and the `stoppedBy` value `missing-key`. `budgetFor` takes the keys the real run would use: the provider's keys when any beat or file would be sent or fetched, none otherwise. It checks, in order: settings, when the estimate is above $0; keys, by presence only (`ctx.secret`, no network), even at $0, since fetching needs the key; then the caps.

The real run follows the same rule: `image generate` and `source transcribe` refuse on settings up front only when something would be paid for, and check keys only when something would be sent or fetched. A run that only fetches saved requests no longer fails on a broken setting.

`nextAfterDryRun(budget, realRun, fetchFree?)` picks the steps by `stoppedBy`:

- `settings`: the user's step, "fix <file>: <issue>", then `config_check` by the agent, "lists every setting that can't be used; run it after the fix".
- `missing-key`: the user's step, "set <KEY>", with the key's fix.
- a cap: the user's step, "the estimate doesn't fit, so ask the user", as today.
- with saved requests among the chosen beats, after those: `image_generate { post, beat: "<n,…>" }` by the agent, "fetches the N images already paid for, at no cost", with no `--yes` in its `cli`.

The user's step comes first in every case. That keeps "Every post SHALL name its next step" true, which says a dry run that doesn't fit leads to the user's call; state-aware-steps owns it. The audit suggested `config_check` first; if state-aware-steps changes that rule, the order can flip.

On the CLI, after the dry run that stands in for a missing `--yes`, `attempt` reads the result's `budget`, as `estimateOf` reads `estimateUsd`:

- it doesn't fit: the error is what the real run would fail with, built from `budget.why` and `budget.fix`, with code `failed` for settings, `missing-key` for a key, `over-budget` for a cap;
- the estimate is $0 and it fits: the CLI runs the operation again for real and prints that result, exit 0;
- otherwise, `needs-confirmation`, as today.

In a batch, each post gets its own result; which code the batch's own error carries is agent-recovery's.

Alternatives:

- For $0, end the dry run with exit 0 and a next step that still needs `--yes`. Rejected: `--yes` confirms spending, and there's none; the free-fetch step would then need `--yes`, which would also confirm a paid run if the post changed in between. With this rule, the step without `--yes` can never pay without asking.
- Let the operation decide, through `RunMode`. Rejected: an explicit `--dry-run` and a missing `--yes` arrive the same way, and only the CLI knows which it was.

### Unknown settings

`readSettings` decodes each file a second time with `{ errors: "all", onExcessProperty: "error" }` and keeps only the `UnexpectedKey` issues (`SchemaIssue.UnexpectedKey`, `effect@4.1.2`). The first decode, with the default "ignore", still gives the values, so the file's other settings apply. Each unknown key becomes an issue naming its path and the closest setting.

Every `SHORTS_*` variable that isn't one of these becomes an issue too: a setting's variable (`SHORTS_<path>`, `SHORTS_BRAND_<path>`), `SHORTS_DATA_DIR`, `SHORTS_POSTS_DIR`, `SHORTS_<PROVIDER>_URL`, or the installer's `SHORTS_INSTALL_DIR` and `SHORTS_VERSION`. A `SHORTS_MODELS_*` variable says models are set in config.json only.

"Closest" is the setting the unknown name starts, else the one at the smallest edit distance, up to a third of the name's length, else the group's settings listed. One helper, `closest(name, candidates)`, which agent-recovery's "did you mean" can share.

Unknown keys are issues, not warnings, so spending stops until they're fixed. That's the rule "Spending SHALL stop while the settings aren't valid" already applies to every issue.

Alternatives:

- Decode with `onExcessProperty: "error"` only. Rejected: one stray key would drop the whole file, caps included.
- Warn, and block only for keys near `caps`. Rejected: "near" is a guess (`limits` isn't near `caps`), and a missed cap costs money while a false alarm costs one edit.

### What a settings problem puts at risk

`settingsIssues` becomes a list of `{ source, risk, text }`. `source` is the file or variable. `risk` is:

- `caps`: config.json couldn't be used (its caps are the defaults), a `SHORTS_CAPS_*` variable isn't valid, or an unknown key or variable whose closest setting is a cap;
- `brand`: brand.json or a `SHORTS_BRAND_*` variable;
- `setting`: anything else, which leaves one setting at its default.

`settingsRefusal` words the message by the first issue's risk: "the caps may be the defaults rather than yours", "images would be made without your brand's style", or "<setting> would be its default". Its fix still names `doctor`, now as "doctor (`config_check` over MCP)", and keeps the restart sentence. A brand problem keeps blocking spending: images made without the brand's style are money wasted too, as agent-experience decided.

### Where caps come from

`Context` gains `capsFrom`: for each cap, `default`, the config.json path, or the variable that set it, filled in `node.ts` as it overlays the layers. `budget show` returns `capsFrom` and `settingsIssues`; `models list` returns `settingsIssues`. The over-budget fix says "Raising caps.dailyUsd (set by SHORTS_CAPS_DAILY_USD) is the user's decision", or "(set in <path>)", or "(its default; it's set in <path>)".

### MCP restarts

The server keeps reading settings once. Every settings row's fix in `config check`, and every key row's, adds: "A running MCP server keeps the settings and environment it started with: restart it after the fix." A key row on macOS adds that a Keychain entry is read on every call. How to set a key stays as agent-recovery words it.

Alternatives:

- Re-read the settings on every call. Rejected, as in agent-experience: it would change which providers a running server uses.
- Re-read them only in `config_check`. Rejected: `doctor` would say `Ready.` while the running server still refuses with the old settings.

### `doctor`: folders, the ledger, and codes

`runChecks` gains three rows, all blocking: the data folder, the posts folder (each a folder this user can write, or missing with a parent that can be written), and the ledger (`readLedger` succeeds; "none yet" when missing). A failed folder row names the variable that set it, if any.

`Check` gains an optional `code`: settings, folders and the ledger `failed`; keys `missing-key`; a model row the code of `chooseModel`'s failure; provider tool rows `missing-tool` when they set none. `config show` returns it, and `renderChecks` prints it in brackets. `doctor` still fails with `missing-tool`.

The corrupt-ledger fix (`ledger.ts:90`) changes. For a line in the middle: "This file is the record of what was spent, and the caps are checked against it, so what to do with that line is the user's decision." For an unfinished last line, the failing line being the last one and the file not ending in a line break: "A command was cut off while writing this line. Remove it: nothing was sent for it, and removing it can't make the caps count less than was spent." That holds because a reservation's line is written before its request is sent, and an unfinished settle or release leaves the reservation counted in full.

Alternative: a new requirement giving `doctor` the code of its first blocking row. Rejected: "The setup check SHALL fail with the fixes" fixes `missing-tool`, and it isn't this change's to modify.

### Locks

`Context` gains `processStartedAt(pid)`, filled in `node.ts` with `ps -o etime= -p <pid>` (POSIX, on macOS and Linux), run with `runProcess`, so it uses `spawn` with `stopWhenAborted`. It's undefined on Windows or when `ps` fails. `withLock` takes it as an optional probe. When a lock's holder is alive, the probe is asked once per holder: a process that started after the lock's `since`, past a minute of slack for clock changes, isn't the holder, and the lock is taken over as a stale one is. The post store and the ledger pass `ctx`'s probe.

`busyPost` and the ledger's busy error name the holder (pid, command, since) and the lock file, and end: "If process N isn't shorts-studio, the lock was left behind: delete <file>, then run this again."

Alternative: only the message. Rejected: a reused pid would keep the lock busy until someone reads the fix; the probe ends that on its own on macOS and Linux.

### Amounts

A small `money.ts` in `usecases`:

- `usd(x)`: at least two decimals, and more, up to six, until two significant digits show; extra trailing zeros dropped. So $0.0003, $0.012, $0.072, $0.50, $2.00.
- `usdOf(spent, cap)`: both with the fewest decimals, from two to six, at which they differ when they differ.
- `roundUsd(x)`: to millionths, as `left` already rounds.

Every money string in `ledger.ts`, `budget.ts`, `image.ts`, `audio.ts`, `source-download.ts` and `config.ts` goes through them. Every dollar amount in a result goes through `roundUsd`.

## Overlaps with other open changes

- **parallel-stories** owns which beats keep running after a failure (task 1.6). This change adds resumes-first, the saved and pending beats in the over-budget message, and the free-fetch step. Its spec says the run fails "with that first failure's error, unchanged"; here the code and the reason stay, and the message and fix grow. If that change reads "unchanged" strictly, the two should agree on "the same code" before either is archived.
- **agent-recovery** adds `nextSteps` to errors and rewords fixes written in CLI or shell terms. Fixes this change writes name both forms where they name a command (`doctor`, `config_check` over MCP), and leave the Keychain wording to it. It also owns the batch error's code.
- **state-aware-steps** owns "Every post SHALL name its next step" and whether a beat with a saved request counts as done. The dry-run steps here start with the user's, so that rule holds.
- **renderer-text-layers** modifies "The setup check SHALL fail with the fixes" and "Providers SHALL be chosen in settings"; this change adds requirements beside them and modifies neither.

## Risks / Trade-offs

- [A not-sent code missing from the list] → It stays counted, as today; the list can grow. A test pins each listed code, and an unknown one stays `ProviderFailed`.
- [A code on the list after all raised once the request was written] → `ECONNRESET`, `EPIPE` and `UND_ERR_SOCKET`, the ones a reused connection raises, are left off it on purpose.
- [Unknown keys now stop spending] → A setup with stray keys gets refusals after updating. The refusal and `doctor` name each key and the closest setting. CHANGELOG marks it **BREAKING**.
- [Exit 4 or 1 instead of 3 without `--yes`] → Scripts that branch on exit 3 to show an estimate first now get the reason instead. CHANGELOG marks it **BREAKING**; the make-shorts skill is updated in the same change.
- [`ps` slow or missing] → The probe has a short deadline and is asked once per holder; without it, the lock behaves as today and the message says what to do.
- [A free fetch over MCP that turns paid] → The step's tool call runs for real; if the post changed in between and a beat now needs a new request, it reserves under the caps like any call, and the client's approval prompt still asks.

## Migration Plan

No data migration: `post.json` and the ledger keep their shapes. `images.lock` appears in post folders while `image generate` runs. Settings files with unknown keys need editing before the next paid call; `doctor` lists them. Rollback is a revert: the new result fields and the `interrupted` code are additive.
