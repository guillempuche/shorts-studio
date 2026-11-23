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

### Requirement: Every post SHALL name its next step

`post show` and every command that changes a post SHALL return `next`, the command that moves the post forward, and `nextSteps`: each step's MCP tool and arguments when it has one, its CLI command, and `by`, `agent` or `user`. A step that spends money SHALL first be its dry run, and that dry run's next step SHALL be the real run, or the user's call when the estimate doesn't fit. The steps SHALL redo what no longer matches the post's own inputs. An archived post SHALL have none.

#### Scenario: A post with audio but no transcript

- **WHEN** `post show` runs on it
- **THEN** `next` is `audio transcribe --post <slug> --dry-run`
- **AND** its first step is the tool `audio_transcribe` with `{ post: <slug>, dryRun: true }`, by `agent`

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

#### Scenario: New audio after the beats

- **WHEN** `source import` brings new audio to a post that has a transcript and beats
- **THEN** its first step is the tool `audio_transcribe` with `{ post: <slug>, dryRun: true }`

#### Scenario: Beats cut from an earlier transcript

- **WHEN** the transcript was made again with other words after beats with prompts were planned
- **THEN** the first step is the tool `beat_plan` with `{ post: <slug>, force: true }`
- **AND** its note says how many prompts planning again drops

#### Scenario: A music post

- **WHEN** `post show` runs on a post whose audio is music and that has no beats
- **THEN** `next` is `beat plan --post <slug>`
- **AND** no step transcribes the audio

#### Scenario: Moments without prompts

- **WHEN** some beats have a story moment, none has a prompt, and the beats weren't re-cut by moment
- **THEN** the first step is the tool `beat_plan` with `{ post: <slug>, byMoment: true }`
- **AND** the step after it, marked `or`, is the tool `beat_set`

#### Scenario: A prompt changed after its image

- **WHEN** beat 1's prompt changed after its image was made, beat 0's image is up to date, and the user approved the script again
- **THEN** `next` is `image generate --post <slug> --beat 1 --dry-run`

#### Scenario: A request in flight

- **WHEN** beat 0 has an image request that was sent and not yet saved, and beat 1's image is up to date
- **THEN** the first step is the tool `image_generate` with `{ post: <slug>, beat: "0", dryRun: true }`

#### Scenario: An image file that's gone

- **WHEN** beat 1's generated image file was deleted, and beat 0's image is up to date
- **THEN** the first step is the tool `image_generate` with `{ post: <slug>, beat: "1", dryRun: true }`

#### Scenario: A draft out of date before its review

- **WHEN** a beat's moment changes after the draft was rendered and before the user reviewed it
- **THEN** the first step is the tool `draft_render`
- **AND** the user's review comes after it

#### Scenario: An approved draft whose beats changed

- **WHEN** a beat's motion changes after the user approved the draft
- **THEN** the first step is the tool `draft_render`, not `capcut_export`

#### Scenario: Fixes asked

- **WHEN** the user's review asks for fixes, with notes on beats 1 and 3
- **THEN** the first steps are the agent's, one per note, each naming its beat, its note and the tools that fix it
- **AND** until a fix changes the draft's inputs, the last step is a note to render the draft once the fixes are made, with no tool
- **AND** once one has, `draft_render` comes after them

#### Scenario: A rejected draft

- **WHEN** the user's review rejects the draft
- **THEN** the step is the user's, asking whether to rework the post or archive it, with no tool

#### Scenario: After the CapCut export

- **WHEN** `capcut export` runs on an approved draft
- **THEN** its first step is the user's: polishing in CapCut desktop
- **AND** no step exports again

#### Scenario: A published post

- **WHEN** `post show` runs on a post that's published
- **THEN** its steps are `post_publish` for another platform, or `post_archive`
- **AND** no step from before the draft appears, even when an image no longer matches its prompt

#### Scenario: An archived post

- **WHEN** `post show` runs on an archived post
- **THEN** `nextSteps` is empty
- **AND** `next` says the post is archived

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

Every CLI command that works on one existing post SHALL also accept a comma-separated `--post`, or `--day today|YYYY-MM-DD` and `--in-stage <stage>`, alone or together, but never `--post` with them. It SHALL run once for each matching post and report each post's result or error, in one object with `--json`. When posts fail, it SHALL fail with the code they share, else with `over-budget`, `needs-approval` or `failed` in that order, and its fix SHALL name the failed posts.

#### Scenario: Today's posts

- **WHEN** `draft render --day today` runs
- **THEN** every post created today is rendered
- **AND** each post's result is reported

#### Scenario: No selection

- **WHEN** a post command gets no post and no selection
- **THEN** it exits 2
- **AND** its fix names the options

#### Scenario: A post and a day together

- **WHEN** `draft render --post <slug> --day today` runs
- **THEN** it exits 2 and renders nothing
- **AND** its fix says to pick posts by `--post`, or by `--day` and `--in-stage`

#### Scenario: A day that doesn't exist

- **WHEN** `draft render --day 2026-13-45` runs
- **THEN** it exits 2 and renders nothing

#### Scenario: Posts that wait on the user

- **WHEN** `image generate --day today --yes` runs and no post's script is approved
- **THEN** it exits 3 with code `needs-approval`
- **AND** its fix names the posts and says they wait on the user

#### Scenario: Posts that fail differently

- **WHEN** one post of a batch fails with `over-budget` and another with `not-found`
- **THEN** the batch fails with `over-budget` and exits 4

#### Scenario: Running only the failed posts again

- **WHEN** two posts of three fail with `provider`
- **THEN** the batch fails with `provider`
- **AND** its fix names the command with `--post <first>,<second>`

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

An MCP tool call with a field the tool doesn't take SHALL fail before the operation runs, naming the field and, for a field at the top, the fields the tool takes. It SHALL spend nothing and change nothing. Each tool's input schema, as `tools/list` and `schema show` publish it, SHALL say `additionalProperties: false`, also for the objects inside it.

#### Scenario: A misspelt dry run

- **WHEN** a client calls `image_generate` with `{ post: <slug>, dry_run: true }`
- **THEN** nothing is reserved or sent
- **AND** the error names `dry_run` and lists `dryRun` among the fields

#### Scenario: Listing the tools

- **WHEN** a client lists the tools, on any protocol version the server offers
- **THEN** every tool's `inputSchema` has `additionalProperties: false`

#### Scenario: The schema without MCP

- **WHEN** `schema show --name beat_set` runs
- **THEN** its input schema has `additionalProperties: false`
- **AND** so does each item of `beats`

#### Scenario: A field inside a list

- **WHEN** a client calls `beat_set` with `{ post: <slug>, beats: [{ beat: 0, promt: "x" }] }`
- **THEN** the call fails and names `promt`
- **AND** no beat changes

### Requirement: A post not found SHALL suggest the one meant

When no post has the given slug, the `not-found` error SHALL suggest the posts meant: its fix and its `nextSteps` SHALL name each post whose slug is that slug with a date in front, or point at `post list` when there's none.

#### Scenario: The slug without its date

- **WHEN** `post show --post ax-test` runs and the only matching post is `2026-11-08-ax-test`
- **THEN** it fails with `not-found`
- **AND** the fix names `2026-11-08-ax-test`
- **AND** its first step is the tool `post_show` with `{ post: "2026-11-08-ax-test" }`

#### Scenario: Several dated posts

- **WHEN** `post show --post ax-test` runs and `2026-11-08-ax-test` and `2026-11-09-ax-test` both exist
- **THEN** it fails with `not-found`
- **AND** the fix names both
- **AND** `nextSteps` holds a `post_show` step for each

#### Scenario: No post like it

- **WHEN** `post show --post nope` runs and no slug ends in `nope`
- **THEN** its first step is the tool `post_list`

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

### Requirement: Steps after the draft SHALL go to who acts next

`capcut export`, `post finalize` and `post publish` SHALL refuse a draft whose current review doesn't approve it, by who acts next. While it waits for the user's review: `needs-approval`, naming `post review --decision <decision>`. When the user rejected it: `needs-approval`, asking them to rework or archive the post. When the user asked for fixes: `conflict`, naming each note and `draft render`.

#### Scenario: Exporting before the review

- **WHEN** `capcut export` runs on a draft the user hasn't reviewed
- **THEN** nothing is exported
- **AND** it fails with `needs-approval`, and its fix names `post review --post <slug> --decision <decision>`

#### Scenario: Exporting a draft that needs fixes

- **WHEN** `capcut export` runs on a draft whose review asks for fixes, with a note on beat 1
- **THEN** nothing is exported
- **AND** it fails with `conflict`, and its fix names beat 1's note and `draft render`

#### Scenario: Publishing a rejected draft

- **WHEN** `post publish` runs on a post whose draft the user rejected
- **THEN** no platform is recorded
- **AND** it fails with `needs-approval`, and its fix asks the user to rework or archive the post

### Requirement: `post show` SHALL show the user's review

The text output of `post show` SHALL print the current review: its decision, its note and each beat's note.

#### Scenario: A review with notes

- **WHEN** `post show` runs without `--json` on a post whose review asks for fixes, with "too dark" on beat 1
- **THEN** its output shows the decision `fix`
- **AND** it shows `beat 1: too dark`

### Requirement: An error SHALL carry its next steps

When a fix names a command to run or a step only the user can take, the error object SHALL also hold `nextSteps`, in the shape results use: each step's MCP tool and arguments when it has one, its CLI command, and `by`. A step only the user can take, such as an approval, setting an API key or a CLI-only command, SHALL be `by: user`, and the fix SHALL say to ask the user. `fix` SHALL stay text.

#### Scenario: A post not found over MCP

- **WHEN** a client calls `post_show` with a slug no post has
- **THEN** the error object holds `code`, `message`, `fix` and `nextSteps`
- **AND** its first step is the tool `post_list`, by `agent`

#### Scenario: A missing key

- **WHEN** `audio_transcribe` runs on a post with audio and the transcription key isn't set
- **THEN** it fails with `missing-key`
- **AND** its first step is by `user`, with no tool
- **AND** the fix says to ask the user to set the key

#### Scenario: An approval the user owns

- **WHEN** `image_generate` runs on a post whose script isn't approved
- **THEN** it fails with `needs-approval`
- **AND** its first step is `script approve --post <slug>`, by `user`, with no tool

#### Scenario: A setting that can't be used

- **WHEN** a paid call is refused because config.json isn't valid
- **THEN** its first step is the tool `config_check`, by `agent`
- **AND** the step after it is the user's

### Requirement: Next steps SHALL be callable with MCP alone

A step by `agent` SHALL be one an MCP client can take with the server's tools alone. When a tool takes content inline, the step SHALL pass it inline instead of naming a file to write first. Each value the agent supplies SHALL be a placeholder listed in `fill`, such as `<script>`, or `<script.md>` for a file. No fix or step SHALL end in an ellipsis.

#### Scenario: Beats without moments or prompts

- **WHEN** `post show` runs on a post whose beats have no moments and no prompts
- **THEN** its first step is the tool `beat_set` with `{ post: <slug>, beats: "<beats>" }`
- **AND** its `fill` lists `beats`
- **AND** its note names the beats to fill and the shape of each item

#### Scenario: Beats with prompts but no script

- **WHEN** `post show` runs on a post whose beats all have prompts and that has no script
- **THEN** its first step is the tool `script_set` with `{ post: <slug>, text: "<script>" }`
- **AND** its `fill` lists `text`

#### Scenario: Beats without audio

- **WHEN** `beat_plan` runs on a post with no audio
- **THEN** it fails with a first step that is the tool `source_import`, with `file` in its `fill`
- **AND** its fix doesn't end in an ellipsis

### Requirement: Scripts and beat settings SHALL be passed inline or from a file

`script set` SHALL take the script as `text` or from `file`. `beat set` SHALL take a `beats` list (JSON text on the CLI), a JSON file (`from`), or one beat's `prompt`, `moment` or `motion` with `beat`. Each SHALL take exactly one of its forms. A relative path SHALL be read from the folder the command runs in, and an error about the file SHALL name its full path.

#### Scenario: A script passed inline

- **WHEN** a client calls `script_set` with `{ post: <slug>, text: <markdown> }`
- **THEN** the post's script.md holds that text

#### Scenario: Two forms at once

- **WHEN** `script set` gets both `--text` and `--file`
- **THEN** it exits 2
- **AND** no script is saved

#### Scenario: Beats passed inline

- **WHEN** a client calls `beat_set` with `{ post: <slug>, beats: [{ beat: 0, moment: "hook", prompt: <prompt> }] }`
- **THEN** beat 0 has that moment and prompt

#### Scenario: Beats that aren't JSON

- **WHEN** `beat set --post <slug> --beats 'not json'` runs
- **THEN** it exits 2
- **AND** no beat changes

#### Scenario: A file that isn't there

- **WHEN** `script set --post <slug> --file missing.md` runs
- **THEN** it fails with `not-found`
- **AND** the message names the full path it looked at

### Requirement: Beat settings and scripts SHALL be checked before they're saved

`beat set` SHALL refuse with `usage`, saving nothing, a prompt that is empty or only spaces and a beat named twice. `script set` SHALL refuse an empty script and a hook that isn't 3 to 7 words; an empty hook SHALL remove the hook. The hook SHALL stay out of the script's approval, since the draft the user reviews shows it.

#### Scenario: A blank prompt

- **WHEN** `beat set --beat 0 --prompt "   "` runs
- **THEN** it exits 2
- **AND** beat 0's prompt is unchanged

#### Scenario: A beat named twice

- **WHEN** `beat set` gets a `beats` list that names beat 1 twice
- **THEN** it exits 2, naming beat 1
- **AND** no beat changes

#### Scenario: An empty script

- **WHEN** `script set --text ""` runs
- **THEN** it exits 2
- **AND** no script is saved

#### Scenario: A long hook

- **WHEN** `script set` gets a `--hook` of nine words
- **THEN** it exits 2
- **AND** the fix says 3 to 7 words

#### Scenario: A new hook after approval

- **WHEN** only the hook changes after the script was approved
- **THEN** the script stays approved
- **AND** the next `draft render` renders the draft again

### Requirement: Beat lists SHALL name only beats the post has

`image generate --beat` SHALL take whole beat numbers from 0, separated by commas, each one a beat of the post. Any other value SHALL fail with `usage`, naming the values it can't use and the post's beats, before anything is reserved or sent.

#### Scenario: A beat the post doesn't have

- **WHEN** `image generate --beat 7 --dry-run` runs on a post with beats 0 and 1
- **THEN** it exits 2
- **AND** the message names 7 and the beats 0–1

#### Scenario: Not a beat number

- **WHEN** `image generate --beat` gets `0x`, `1.5` or `-1`
- **THEN** it exits 2
- **AND** nothing is reserved or sent

### Requirement: Post names SHALL be checked before a post is made

`post create` SHALL refuse with `usage`, creating nothing, a name that is empty, a slug longer than 100 characters (saying so and how long it is), and a slug that starts with a date that doesn't exist. The examples in its fixes SHALL hold no fixed date.

#### Scenario: An empty name

- **WHEN** `post create --post ""` runs
- **THEN** it exits 2
- **AND** no post folder is made

#### Scenario: A name too long

- **WHEN** `post create` gets a name of 120 characters
- **THEN** it exits 2
- **AND** the message says a slug holds at most 100 characters, the date included, and how long this one is

#### Scenario: A date that doesn't exist

- **WHEN** `post create --post 2026-13-45-x` runs
- **THEN** it exits 2
- **AND** the message names `2026-13-45`

### Requirement: A published URL SHALL be a full address

`post publish` SHALL refuse with `usage`, recording nothing, a URL that isn't `http` or `https` with a host.

#### Scenario: A bare scheme

- **WHEN** `post publish --url https://` runs
- **THEN** it exits 2
- **AND** the post records no new platform

### Requirement: Spending on a post that doesn't exist SHALL NOT read as nothing

`budget show --post` SHALL fail with `not-found`, suggesting the post meant, when no post, no saved collection and no spending go by that name. A post with no spending yet SHALL show $0.

#### Scenario: A misspelt post

- **WHEN** `budget show --post nope` runs and nothing goes by that name
- **THEN** it fails with `not-found`

#### Scenario: A post with nothing spent

- **WHEN** `budget show --post <slug>` runs for a post that has spent nothing
- **THEN** it lists that post at $0

### Requirement: A collection download SHALL fail when nothing can be downloaded

`source download --collection` SHALL fail, before running yt-dlp, when urls.txt isn't a file or holds no URL. When yt-dlp fails and nothing new came down, it SHALL fail with yt-dlp's last error lines. `--url` without `--post`, or `--post` without `--url`, SHALL fail with `usage`, naming the one missing.

#### Scenario: An empty urls.txt

- **WHEN** `source download --collection <name>` runs and its urls.txt holds no URL
- **THEN** it fails without running yt-dlp
- **AND** the fix says to put one URL per line in urls.txt

#### Scenario: A URL without a post

- **WHEN** `source download --url <url>` runs without `--post`
- **THEN** it exits 2
- **AND** the message says `--url` needs `--post`

### Requirement: Collection transcription SHALL say what's next and what failed

`source transcribe` SHALL return `next` and `nextSteps` after a dry run and after a run with failed files. Each failed file SHALL come with its error's code and fix. A file it can't read SHALL be listed as failed instead of stopping the dry run. A run stopped by a cap SHALL say how many files it transcribed first.

#### Scenario: After a dry run

- **WHEN** `source transcribe --collection <name> --dry-run` runs and the estimate fits
- **THEN** its first step is the tool `source_transcribe` with `{ collection: <name> }`

#### Scenario: A file it can't read

- **WHEN** one audio file of three can't be read and `source transcribe --dry-run` runs
- **THEN** the other two are estimated
- **AND** the third is listed as failed, with its fix

#### Scenario: A cap reached part-way

- **WHEN** a cap is reached after two of five files
- **THEN** it fails with `over-budget`
- **AND** the message says two files were transcribed and kept

### Requirement: --json SHALL print one object however the CLI is called

With `--json`, `--version` SHALL print one object holding the version. `--wizard`, and a `--json=` value that isn't one of the yes or no words, SHALL print the usage error object and exit 2.

#### Scenario: The version as JSON

- **WHEN** `--version --json` runs
- **THEN** stdout holds one JSON object with the version

#### Scenario: A value --json doesn't take

- **WHEN** `post list --json=maybe` runs
- **THEN** stdout holds one JSON object whose `error.code` is `usage`
- **AND** it exits 2

#### Scenario: The wizard

- **WHEN** `post list --wizard --json` runs
- **THEN** no question is asked
- **AND** stdout holds one JSON object whose `error.code` is `usage`

### Requirement: A usage error SHALL point at the flag meant

When a command gets `--stage` where it takes `--in-stage`, or `--in-stage` where it takes `--stage`, its usage error SHALL name the flag it takes. When it gets `--post` more than once, the error SHALL say to separate several posts with commas.

#### Scenario: The batch flag on post list

- **WHEN** `post list --in-stage idea` runs
- **THEN** it exits 2
- **AND** the fix names `--stage`

#### Scenario: Two posts as two flags

- **WHEN** `draft render --post a --post b` runs
- **THEN** it exits 2
- **AND** the fix names `--post a,b`

### Requirement: Schemas SHALL be found by either name

`schema show` SHALL take a command's name as the CLI writes it (`image generate`) or as its tool (`image_generate`). Its list of names SHALL mark the operations that aren't MCP tools.

#### Scenario: The CLI's name

- **WHEN** `schema show --name "image generate"` runs
- **THEN** it prints the schemas of `image_generate`

#### Scenario: Listing the names

- **WHEN** `schema show` runs without a name
- **THEN** `script_approve` is marked as CLI-only

### Requirement: Overridden provider addresses SHALL show in the setup check

When a `SHORTS_<PROVIDER>_URL` variable sends a provider in use to another address, `config show` and `doctor` SHALL show a warning row naming the variable and the address, without failing.

#### Scenario: A test address left set

- **WHEN** `SHORTS_FAL_URL` is set and FAL makes the images
- **THEN** `config show` has a warning row naming `SHORTS_FAL_URL` and its address
- **AND** `doctor` still ends with `Ready.` when nothing else blocks

### Requirement: A dry run's text SHALL end with its next step

The text a spending command prints for a dry run SHALL end with `Next:` and its next step, as its `--json` result's `next` does.

#### Scenario: A transcription dry run as text

- **WHEN** `audio transcribe --post <slug> --dry-run` runs without `--json`
- **THEN** its last line starts with `Next:`
