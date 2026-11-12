## MODIFIED Requirements

### Requirement: Exit codes SHALL always mean the same thing

The CLI SHALL exit with 0 on success (including `--dry-run`), 1 on failure, 2 when the command is used wrongly, 3 when a step needs `--yes` (code `needs-confirmation`) or the user's approval (code `needs-approval`), 4 when a spending cap would be passed, and 130 when interrupted.

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

### Requirement: Every post SHALL name its next step

`post show` and every command that changes a post SHALL return `next`, the command that moves the post forward, and `nextSteps`: each step's MCP tool and arguments when it has one, its CLI command, and `by`, `agent` or `user`. A step that needs `--yes` SHALL first be its dry run, and that dry run's next step SHALL be the real run, or the user's call when the estimate doesn't fit.

#### Scenario: A post with audio but no transcript

- **WHEN** `post show` runs on it
- **THEN** `next` is `audio transcribe --post <slug>`
- **AND** its first step is the tool `audio_transcribe` with `{ post: <slug> }`, by `agent`

#### Scenario: A post ready for images

- **WHEN** `post show` runs on a post whose script is approved and whose beats have no images
- **THEN** `next` is `image generate --post <slug> --dry-run`
- **AND** its first step is the tool `image_generate` with `{ post: <slug>, dryRun: true }`

#### Scenario: After a dry run of images

- **WHEN** `image generate --dry-run` runs on that post
- **THEN** its first step is the tool `image_generate` with `{ post: <slug> }` and the CLI command with `--yes`

#### Scenario: After a dry run that won't fit

- **WHEN** `image generate --dry-run` estimates more than is left of today's cap
- **THEN** its first step is the user's, naming the cap, with no tool

#### Scenario: A step that's the user's

- **WHEN** `post show` runs on a post whose script waits for approval
- **THEN** its first step is `script approve --post <slug>`, by `user`, with no tool

### Requirement: The setup check SHALL fail with the fixes

`config check` and its alias `doctor` SHALL check ffmpeg (with libass), ffprobe, yt-dlp and the API keys. When something blocks the work, it SHALL fail with code `missing-tool`, name each blocking problem with its fix, and name `config show --json`, which lists every check with its status and fix.

#### Scenario: No ffmpeg

- **WHEN** ffmpeg isn't installed
- **THEN** `doctor` exits 1
- **AND** its message names ffmpeg and how to install it

#### Scenario: A broken settings file

- **WHEN** config.json or brand.json isn't valid
- **THEN** every command still starts, using the defaults and any valid `SHORTS_*` variables
- **AND** `doctor` fails, naming the file and the problem

#### Scenario: The checks as data

- **WHEN** `doctor --json` fails
- **THEN** its fix names `config show --json`
- **AND** it doesn't refer to rows printed above

### Requirement: The user's decisions SHALL need an interactive terminal

`script approve` and `post review` SHALL refuse with code `needs-approval`, and record nothing, when stdin isn't an interactive terminal or when a known agent marker such as `CLAUDECODE` is set. An agent's shell has no terminal, and one that has a pseudo-terminal still carries its marker.

#### Scenario: An agent runs an approval

- **WHEN** `script approve` runs with stdin that isn't a terminal
- **THEN** the script stays unapproved
- **AND** the command exits 3 with code `needs-approval`
- **AND** the fix asks the user to run it in their own terminal

#### Scenario: An agent with a pseudo-terminal

- **WHEN** `script approve` runs with a terminal and `CLAUDECODE` set
- **THEN** the script stays unapproved
- **AND** the fix asks the user to run it in a terminal outside the agent

#### Scenario: The user approves

- **WHEN** the user runs `script approve` in their terminal
- **THEN** the script is approved

## ADDED Requirements

### Requirement: MCP tools SHALL refuse fields they don't take

An MCP tool call with a field the tool doesn't take SHALL fail before the operation runs, naming the field and the fields the tool takes. It SHALL spend nothing and change nothing.

#### Scenario: A misspelt dry run

- **WHEN** a client calls `image_generate` with `{ post: <slug>, dry_run: true }`
- **THEN** nothing is reserved or sent
- **AND** the error names `dry_run` and lists `dryRun` among the fields

### Requirement: A post not found SHALL suggest the one meant

When no post has the given slug but exactly one post's slug is that slug with a date in front, the `not-found` error's fix SHALL name that post.

#### Scenario: The slug without its date

- **WHEN** `post show --post ax-test` runs and the only matching post is `2026-11-08-ax-test`
- **THEN** it fails with `not-found`
- **AND** the fix names `2026-11-08-ax-test`
