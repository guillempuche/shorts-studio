## MODIFIED Requirements

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

## ADDED Requirements

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
