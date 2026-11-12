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

### Requirement: Models SHALL be data, not code

Each provider SHALL ship the models it knows, each with its endpoint, what it's billed by, its price per unit and the date that price was checked. `config.json` SHALL be able to add a model or change a price under `models`. A model from a family its provider already handles SHALL need no code change.

#### Scenario: A new model in config.json

- **WHEN** `config.json` adds a FLUX model on FAL with its endpoint and price
- **THEN** `image generate --model` accepts it
- **AND** reserves its price

### Requirement: Old prices SHALL be flagged

`models list` SHALL show each job's models with their price and the date it was checked. `doctor` SHALL warn, without failing, when a model in use has a price checked more than 90 days ago.

#### Scenario: A stale price

- **WHEN** the image model in use had its price checked 120 days ago
- **THEN** `doctor` warns and says where to update the price
- **AND** still ends with `Ready.`

#### Scenario: Listing the models

- **WHEN** `models list` runs
- **THEN** each job's models show their price per unit, the day it was checked and how many days ago that was
- **AND** the model each job uses is marked

### Requirement: Models in config.json SHALL be checked

`doctor` SHALL fail when the model a job uses can't be used, naming it and the models to use instead. It SHALL warn, without failing, about a model in `config.json` that no provider in use claims, such as a misspelt name.

#### Scenario: A misspelt model name

- **WHEN** `config.json` changes the price of `flux-shcnell`
- **THEN** `doctor` warns that nothing uses `models.flux-shcnell`
- **AND** still ends with `Ready.`

### Requirement: The MCP server SHALL speak the newest protocol and keep older clients

The MCP server SHALL serve protocol versions 2026-07-28, 2025-11-25 and 2025-06-18. A 2026-07-28 request SHALL get the same tools, results and error objects as a request on an earlier version. A client that initializes with an offered version SHALL get that version; one that asks for any other version SHALL get 2025-11-25.

#### Scenario: A client on 2026-07-28

- **WHEN** a client sends 2026-07-28 requests, without initializing, to list the tools and to call `post_show` for a post that doesn't exist
- **THEN** it gets every shared tool
- **AND** the call returns the `{ code, message, fix }` error object with `isError: true`

#### Scenario: A client on an earlier version

- **WHEN** a client initializes with 2025-06-18
- **THEN** the server answers with 2025-06-18

#### Scenario: A client on a version the server doesn't offer

- **WHEN** a client initializes with 2025-03-26
- **THEN** the server answers with 2025-11-25

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
