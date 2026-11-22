## MODIFIED Requirements

### Requirement: Output SHALL keep results apart from log messages

With `--json`, the CLI SHALL print exactly one JSON object on stdout: `{ ok, outputVersion, command, result }` on success, or `{ ok: false, outputVersion, command, error: { code, message, fix } }` on failure, also when it's called wrong, a step fails unexpectedly, or it's interrupted. Progress, log messages and the trace of an unexpected failure SHALL go to stderr. A failed MCP call SHALL return the same error object with `isError: true`.

#### Scenario: A command fails with --json

- **WHEN** `post show --post nope --json` runs and the post doesn't exist
- **THEN** stdout holds one JSON object
- **AND** its `error.code` is `not-found`
- **AND** its `error.fix` names a command to run

#### Scenario: A command called wrong with --json

- **WHEN** `post list --colour red --json=true` runs, or `post --json` with no command
- **THEN** stdout holds one JSON object whose `error.code` is `usage`
- **AND** the command exits 2

#### Scenario: A file that can't be read

- **WHEN** `script set --file` names a folder, with `--json`
- **THEN** stdout holds one JSON object whose `error.fix` names the path to check

#### Scenario: Interrupted with --json

- **WHEN** the user presses Ctrl-C while `image generate --yes --json` runs
- **THEN** stdout holds one JSON object whose `error.code` is `interrupted`
- **AND** its `error.fix` says to run the same command again, without `--reroll`, to resume

### Requirement: Exit codes SHALL always mean the same thing

The CLI SHALL exit with 0 on success (including `--dry-run`), 1 on failure, 2 when the command is used wrongly, 3 when a step needs `--yes` (code `needs-confirmation`) or the user's approval (code `needs-approval`), 4 when a spending cap would be passed, and 130 when interrupted (code `interrupted`).

#### Scenario: An unknown flag

- **WHEN** a command is called with a flag it doesn't take
- **THEN** it exits 2

#### Scenario: A step that waits on the user

- **WHEN** `image generate --yes` runs on a post whose script isn't approved
- **THEN** it exits 3
- **AND** its error code is `needs-approval`

#### Scenario: Interrupted

- **WHEN** the user presses Ctrl-C while a command runs
- **THEN** its cleanup steps run
- **AND** it exits 130
- **AND** with `--json`, its error code is `interrupted`

## ADDED Requirements

### Requirement: Settings SHALL name what they don't know

A key in `config.json` or `brand.json`, or a `SHORTS_*` variable, that names no setting SHALL be a settings problem, like a value that isn't valid, naming the closest setting. The file's other settings SHALL still apply. `SHORTS_DATA_DIR`, `SHORTS_POSTS_DIR`, a provider's `SHORTS_*_URL` and the installer's variables are not settings and SHALL NOT be reported.

#### Scenario: A key that names no setting

- **WHEN** `config.json` sets `caps.daily` to 0.5 and `caps.postUsd` to 1
- **THEN** `doctor` fails, naming `caps.daily` and `caps.dailyUsd`
- **AND** the per-post cap is 1

#### Scenario: A variable that names no setting

- **WHEN** `SHORTS_CAPS_DAILY` is 1
- **THEN** `doctor` fails, naming `SHORTS_CAPS_DAILY` and `SHORTS_CAPS_DAILY_USD`

#### Scenario: Variables that aren't settings

- **WHEN** `SHORTS_DATA_DIR`, `SHORTS_POSTS_DIR` and `SHORTS_FAL_URL` are set
- **THEN** `doctor` doesn't report them

### Requirement: An interrupted run SHALL say how to resume

The `interrupted` error's fix SHALL name the command to run again. For a spending command, it SHALL say that requests already saved are fetched without paying again, and to leave out `--reroll`. When Ctrl-C arrives while a paid request is being sent, the command SHALL say on stderr that it waits up to 60 seconds for the provider's answer, so the request is saved and not paid for twice.

#### Scenario: Ctrl-C while a request is sent

- **WHEN** the user presses Ctrl-C while `image generate --yes` is sending beat 2's request
- **THEN** stderr says it waits up to 60 seconds to save beat 2's request
- **AND** the request is saved in `post.json` before the command exits 130

### Requirement: Results that read the settings SHALL list their problems

`budget show` and `models list` SHALL list in their result every setting that can't be used (`settingsIssues`), empty when there's none. An MCP client sees no stderr, and their caps or prices may then be the defaults.

#### Scenario: Over MCP

- **WHEN** config.json isn't valid JSON
- **AND** a client calls `budget_show`
- **THEN** the result's `settingsIssues` names config.json and the problem

### Requirement: Fixes SHALL say when the MCP server needs a restart

Every setup check row about a setting or a key, and every refusal because of the settings, SHALL say that a running MCP server keeps the settings and environment it started with, so it needs a restart after the fix. A key in the macOS Keychain SHALL be read on every call, so adding one there SHALL need no restart.

#### Scenario: A setting fixed while the server runs

- **WHEN** a client calls `config_check` and a settings row fails
- **THEN** that row's fix says to restart the MCP server after fixing the setting

### Requirement: The setup check SHALL cover the folders and the ledger

`config check` and `config show` SHALL check that the data and posts folders are folders this user can write, or can be created, and that the ledger reads. Either problem SHALL be blocking, with its fix.

#### Scenario: The posts folder is a file

- **WHEN** `SHORTS_POSTS_DIR` names a file
- **THEN** `doctor` exits 1
- **AND** its message names `SHORTS_POSTS_DIR` and that file

#### Scenario: A corrupt ledger

- **WHEN** a ledger line isn't valid JSON
- **THEN** `doctor` exits 1, naming the ledger and the line

### Requirement: Each setup problem SHALL carry its own code

Each check `config show` lists that isn't ok SHALL carry the code a command would fail with because of it: `missing-key` for a key, `failed` for a setting, a folder or the ledger, `missing-tool` for a tool. `doctor`'s message SHALL name that code beside each blocking problem.

#### Scenario: A missing key

- **WHEN** `FAL_KEY` isn't set
- **THEN** `config show --json` lists the `FAL_KEY` check with code `missing-key`
- **AND** `doctor`'s message names `missing-key` beside `FAL_KEY`

### Requirement: A busy lock SHALL name its holder and its file

When a post's or the ledger's lock stays busy, the error SHALL name the holding process, its command, since when, and the lock file, and say the file is left over if that process isn't shorts-studio. A lock whose process started after the lock was taken, so that its number now belongs to another program, SHALL be taken over.

#### Scenario: The ledger is busy

- **WHEN** another command holds the ledger's lock past the wait
- **THEN** the error names that command's process and the ledger's lock file

#### Scenario: A process number used again

- **WHEN** a post's lock file names a process that started after the lock was taken
- **THEN** the next command takes the lock
