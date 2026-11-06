## ADDED Requirements

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
