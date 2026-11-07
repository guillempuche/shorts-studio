# agent-interface Specification

## Purpose

How people and agents use shorts-studio. One list of operations becomes both CLI commands and MCP tools, with the same names and parameters. Output is easy for programs to read, exit codes always mean the same thing, and every error says what to do next.

## Requirements

### Requirement: Every shared operation SHALL be both a CLI command and an MCP tool

Each operation SHALL be defined once. It SHALL appear as `noun verb` on the CLI and as `noun_verb` over MCP, with the same parameters (kebab-case flags, camelCase tool fields). Operations that record the user's own decision SHALL be CLI-only.

#### Scenario: Listing tools

- **WHEN** an MCP client lists the server's tools
- **THEN** every shared operation is listed, with its parameters as the tool's inputs
- **AND** `script_approve` is not listed

#### Scenario: A spending tool

- **WHEN** a tool that spends money is listed
- **THEN** it also takes `dryRun`

### Requirement: Output SHALL keep results apart from log messages

With `--json`, the CLI SHALL print exactly one JSON object on stdout: `{ ok, outputVersion, command, result }` on success, or `{ ok: false, outputVersion, command, error: { code, message, fix } }` on failure. Progress and log messages SHALL go to stderr. A failed MCP call SHALL return the same error object with `isError: true`.

#### Scenario: A command fails with --json

- **WHEN** `post show --post nope --json` runs and the post doesn't exist
- **THEN** stdout holds one JSON object
- **AND** its `error.code` is `not-found`
- **AND** its `error.fix` names a command to run

### Requirement: Exit codes SHALL always mean the same thing

The CLI SHALL exit with 0 on success (including `--dry-run`), 1 on failure, 2 when the command is used wrongly, 3 when a step needs `--yes` or the user's approval, 4 when a spending cap would be passed, and 130 when interrupted.

#### Scenario: An unknown flag

- **WHEN** a command is called with a flag it doesn't take
- **THEN** it exits 2

#### Scenario: Interrupted

- **WHEN** the user presses Ctrl-C while a command runs
- **THEN** its cleanup steps run
- **AND** it exits 130

### Requirement: Every post SHALL name its next step

`post show` and every command that changes a post SHALL return `next`: the exact command that moves the post forward. When that step is the user's to take, `next` SHALL say so.

#### Scenario: A post with audio but no transcript

- **WHEN** `post show` runs on it
- **THEN** `next` is `audio transcribe --post <slug>`

### Requirement: The evening check SHALL be the user's

`post review` SHALL be CLI-only. It SHALL record in `post.json` the decision (approve, fix, reject), the user's notes, the beats chosen for animation, and the hash of the draft that was reviewed.

#### Scenario: An agent's tools

- **WHEN** an MCP client lists the tools
- **THEN** no tool records a review decision

#### Scenario: The draft is rendered again

- **WHEN** an approved draft is rendered again
- **THEN** the post waits for a new review

### Requirement: Downloads SHALL stay on the CLI

`source download` SHALL be CLI-only. It SHALL run the user's own yt-dlp. It SHALL use browser cookies only when `download.cookiesFromBrowser` is set in config.json.

#### Scenario: Downloading a collection again

- **WHEN** a collection is downloaded again
- **THEN** only the URLs not yet in `downloaded.txt` are downloaded

### Requirement: Schemas SHALL be available without MCP

`schema show` SHALL print the JSON Schema of `post.json` and of each command's input and output. It SHALL build them from the same Schemas the commands use. `schemas/post.schema.json` SHALL match the Post Schema.

#### Scenario: An agent without MCP

- **WHEN** it runs `schema show --name post`
- **THEN** it gets the JSON Schema of `post.json`

### Requirement: The setup check SHALL fail with the fixes

`config check` and its alias `doctor` SHALL check ffmpeg (with libass), ffprobe, yt-dlp and the API keys. When something blocks the work, it SHALL fail with code `missing-tool` and name each blocking problem with its fix.

#### Scenario: No ffmpeg

- **WHEN** ffmpeg isn't installed
- **THEN** `doctor` exits 1
- **AND** its message names ffmpeg and how to install it

#### Scenario: A broken settings file

- **WHEN** config.json or brand.json isn't valid
- **THEN** every command still starts, using the defaults
- **AND** `doctor` fails, naming the file and the problem

### Requirement: Post commands SHALL run on several posts from the CLI

Every CLI command that works on one existing post SHALL also accept a comma-separated `--post`, `--day today|YYYY-MM-DD` or `--in-stage <stage>`. It SHALL run once for each matching post and report each post's result or error. With `--json`, it SHALL print one object that holds every result.

#### Scenario: Today's posts

- **WHEN** `draft render --day today` runs
- **THEN** every post created today is rendered
- **AND** each post's result is reported

#### Scenario: No selection

- **WHEN** a post command gets no post and no selection
- **THEN** it exits 2
- **AND** its fix names the options

### Requirement: Only spending commands SHALL take a dry run

Only commands that spend money SHALL accept `--dry-run`. Any other command given it SHALL change nothing and exit 2. Otherwise it would run for real while the caller thinks it is only a trial run.

#### Scenario: A dry run of an approval

- **WHEN** `script approve --dry-run` runs
- **THEN** the script stays unapproved
- **AND** the command exits 2

### Requirement: An interrupted command SHALL stop the programs it started

When a command is interrupted while a program it started is still running, it SHALL wait for that program to exit, up to a time limit. Only then SHALL it run its cleanup steps and exit.

#### Scenario: Ctrl-C during a render

- **WHEN** the user presses Ctrl-C during `draft render`
- **THEN** ffmpeg has stopped by the time the command exits
- **AND** no temporary file is left

### Requirement: Providers SHALL be chosen in settings

Each job (transcribe, make an image, speak, make music, animate a clip) SHALL be done by the provider named in the settings. Adding a provider SHALL need no change to the use cases or the domain.

#### Scenario: Another image provider

- **WHEN** `config.json` sets `image.provider` to a provider a fork added
- **THEN** `image generate` uses it, with its own price estimate and spending reservation

### Requirement: Settings SHALL come in layers

Settings SHALL come from built-in defaults, then `config.json` and `brand.json`, then `SHORTS_*` environment variables, then flags, each overriding the one before. Both files SHALL match a published JSON Schema.

#### Scenario: An environment override

- **WHEN** `config.json` sets `image.model` to `flux-dev` and `SHORTS_IMAGE_MODEL` is `flux-schnell`
- **THEN** images are made with `flux-schnell`

### Requirement: Keys SHALL never be written or logged

API keys SHALL come only from the environment or the OS keychain, and SHALL never appear in settings files, logs, errors or command output.

#### Scenario: A failed provider call

- **WHEN** a provider rejects a request
- **THEN** the error names the provider and the fix, and holds no key
