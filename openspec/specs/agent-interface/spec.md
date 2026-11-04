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
