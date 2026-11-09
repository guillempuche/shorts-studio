## MODIFIED Requirements

### Requirement: Output SHALL keep results apart from log messages

With `--json`, the CLI SHALL print exactly one JSON object on stdout: `{ ok, outputVersion, command, result }` on success, or `{ ok: false, outputVersion, command, error: { code, message, fix } }` on failure, also when it's called wrong or a step fails unexpectedly. Progress, log messages and the trace of an unexpected failure SHALL go to stderr. A failed MCP call SHALL return the same error object with `isError: true`.

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

### Requirement: The setup check SHALL fail with the fixes

`config check` and its alias `doctor` SHALL check ffmpeg (with libass), ffprobe, yt-dlp and the API keys. When something blocks the work, it SHALL fail with code `missing-tool` and name each blocking problem with its fix.

#### Scenario: No ffmpeg

- **WHEN** ffmpeg isn't installed
- **THEN** `doctor` exits 1
- **AND** its message names ffmpeg and how to install it

#### Scenario: A broken settings file

- **WHEN** config.json or brand.json isn't valid
- **THEN** every command still starts, using the defaults and any valid `SHORTS_*` variables
- **AND** `doctor` fails, naming the file and the problem

### Requirement: Settings SHALL come in layers

Settings SHALL come from built-in defaults, then `config.json` and `brand.json`, then `SHORTS_*` environment variables, then flags, each overriding the one before. Each variable SHALL name exactly one setting; `models` SHALL be set in `config.json` only. A variable that isn't valid SHALL be left out, and the others SHALL still apply. Both files SHALL match a published JSON Schema; a number or yes/no written there as text SHALL be read as that value.

#### Scenario: An environment override

- **WHEN** `config.json` sets `image.model` to `flux-dev` and `SHORTS_IMAGE_MODEL` is `flux-schnell`
- **THEN** images are made with `flux-schnell`

#### Scenario: A variable whose name starts like another setting's

- **WHEN** `config.json` sets `caps.dailyUsd` to 1 and `SHORTS_CAPTIONS_FONT_SIZE` is 64
- **THEN** the daily cap is 1 and the caption size is 64

#### Scenario: A variable that isn't valid

- **WHEN** `SHORTS_CAPS_POST_USD` is `lots` and `SHORTS_CAPTIONS_FONT_SIZE` is 64
- **THEN** the per-post cap keeps its value and the caption size is 64
- **AND** `doctor` names `SHORTS_CAPS_POST_USD`

#### Scenario: A cap written as text

- **WHEN** `config.json` sets `caps.dailyUsd` to `"1"`
- **THEN** the daily cap is 1

### Requirement: Keys SHALL never be written or logged

API keys SHALL come only from the environment or the OS keychain, and SHALL never appear in settings files, logs, errors or command output. A key SHALL be sent only to its provider's own addresses.

#### Scenario: A failed provider call

- **WHEN** a provider rejects a request
- **THEN** the error names the provider and the fix, and holds no key

#### Scenario: A saved request that points elsewhere

- **WHEN** a request saved in `post.json` names an address that isn't the provider's
- **THEN** nothing is sent there
- **AND** the error says to undo the edit or send a new request
