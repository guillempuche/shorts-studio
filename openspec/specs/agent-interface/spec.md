# agent-interface Specification

## Purpose

How people and agents drive shorts-studio: one registry of operations exposed as CLI commands and MCP tools with the same names and parameters, machine-readable output, stable exit codes, and errors that always say what to do next.

## Requirements

### Requirement: Every shared operation SHALL be both a CLI command and an MCP tool

Each operation SHALL be declared once and exposed as `noun verb` on the CLI and `noun_verb` over MCP, with the same parameters (kebab-case flags, camelCase tool fields). Operations that record a decision belonging to the user SHALL be CLI-only.

#### Scenario: Listing tools

- **WHEN** an MCP client lists the server's tools
- **THEN** every shared operation appears with its parameters as the tool's input properties
- **AND** `script_approve` does not appear

#### Scenario: A spending tool

- **WHEN** a tool that spends money is listed
- **THEN** its input also takes `dryRun`

### Requirement: Output SHALL separate results from diagnostics

With `--json` the CLI SHALL print exactly one JSON object on stdout, `{ ok, outputVersion, command, result }` on success or `{ ok: false, error: { code, message, fix } }` on failure. Progress and diagnostics SHALL go to stderr. MCP failures SHALL return the same error object with `isError: true`.

#### Scenario: A command fails with --json

- **WHEN** `post show --post nope --json` runs and the post doesn't exist
- **THEN** stdout holds one JSON object whose `error.code` is `not-found` and whose `error.fix` names a command to run

### Requirement: Exit codes SHALL be stable

The CLI SHALL exit 0 on success (including `--dry-run`), 1 on failure, 2 on a usage error, 3 when a step needs `--yes` or the user's approval, 4 when a spending cap would be passed, and 130 when interrupted.

#### Scenario: An unknown flag

- **WHEN** a command is called with a flag it doesn't take
- **THEN** it exits 2

#### Scenario: Interrupted

- **WHEN** a running command receives SIGINT
- **THEN** its finalisers run and it exits 130

### Requirement: Every post SHALL name its next step

`post show` and every command that changes a post SHALL return `next`: the exact command that moves the post forward, marking steps that are the user's.

#### Scenario: A post with audio but no transcript

- **WHEN** `post show` runs on it
- **THEN** `next` is `audio transcribe --post <slug>`

### Requirement: The evening check SHALL be the user's

`post review` SHALL be CLI-only and SHALL record the decision (approve, fix, reject), the user's notes and the beats chosen for animation in `post.json`, tied to the hash of the draft it was made on.

#### Scenario: An agent's tools

- **WHEN** an MCP client lists the tools
- **THEN** no tool records a review decision

#### Scenario: The draft is rendered again

- **WHEN** an approved draft is re-rendered
- **THEN** the post waits for a new review

### Requirement: Downloads SHALL stay on the CLI

`source download` SHALL be CLI-only, SHALL call the user's own yt-dlp, and SHALL use browser cookies only when `download.cookiesFromBrowser` is set in config.json.

#### Scenario: Re-running a collection

- **WHEN** a collection is downloaded again
- **THEN** only URLs missing from `downloaded.txt` are fetched

### Requirement: Schemas SHALL be discoverable without MCP

`schema show` SHALL print the JSON Schema of the post manifest and of each command's input and output, generated from the same Schemas the commands use, and `schemas/post.schema.json` SHALL match the Post Schema.

#### Scenario: An agent without MCP

- **WHEN** it runs `schema show --name post`
- **THEN** it receives the post manifest's JSON Schema

### Requirement: A machine check SHALL fail with its fixes

`config check` and its alias `doctor` SHALL check ffmpeg (with libass), ffprobe, yt-dlp and the API keys, and SHALL fail with code `missing-tool`, naming each blocking problem and its fix.

#### Scenario: No ffmpeg

- **WHEN** ffmpeg isn't installed
- **THEN** `doctor` exits 1 and its message names ffmpeg and how to get it

#### Scenario: A settings file that doesn't parse

- **WHEN** config.json or brand.json isn't valid
- **THEN** every command still starts with the defaults, and `doctor` fails naming the file and the problem

### Requirement: Post commands SHALL run on several posts from the CLI

Every CLI command acting on one existing post SHALL also accept a comma-separated `--post`, `--day today|YYYY-MM-DD` or `--in-stage <stage>`, run once per matching post, and report each post's result or error; with `--json`, one object holding every result.

#### Scenario: Today's posts

- **WHEN** `draft render --day today` runs
- **THEN** every post created today is rendered and each one's result is reported

#### Scenario: No selection

- **WHEN** a post command gets neither a post nor a selection
- **THEN** it exits 2 with a fix naming the options

### Requirement: Only spending commands SHALL take a dry run

`--dry-run` SHALL be accepted only by commands that spend money. Any other command given it SHALL change nothing and exit 2, rather than run for real while the caller believes it is a rehearsal.

#### Scenario: A dry run of an approval

- **WHEN** `script approve --dry-run` runs
- **THEN** the script stays unapproved and the command exits 2

### Requirement: Interruption SHALL stop child processes before exiting

When a command running a child process is interrupted, it SHALL wait (bounded) until the child has exited before running its finalisers and exiting.

#### Scenario: Ctrl-C during a render

- **WHEN** `draft render` receives SIGINT
- **THEN** ffmpeg has stopped by the time the command exits, and no temporary file remains
