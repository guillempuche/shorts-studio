## ADDED Requirements

### Requirement: Every attempt SHALL be recorded

Each time a command makes or replaces a generated file, it SHALL add one line to the post's `history.jsonl` with what was asked (provider, model, prompt, seed), what it cost and which file it made. Lines SHALL never be changed or removed.

#### Scenario: A rerolled image

- **WHEN** beat 3 is rerolled twice
- **THEN** `history.jsonl` holds three lines for beat 3, each with its own seed and file

### Requirement: Replaced files SHALL be kept until the post is archived

A generated file that is replaced SHALL move to the post's `attempts/` folder. `post archive` SHALL delete the attempts that weren't kept, and SHALL keep `history.jsonl`.

#### Scenario: Archiving

- **WHEN** a post with three attempts for beat 3 is archived
- **THEN** only the kept image remains
- **AND** `history.jsonl` still lists all three

### Requirement: Models SHALL be tried side by side without replacing

With `--try`, `image generate` SHALL make one attempt per model listed in `--model`, from the same prompt, and SHALL leave the beat's current image as it is. Each attempt SHALL reserve its own cost and get its own line in `history.jsonl`.

#### Scenario: Two models for one beat

- **WHEN** `image generate --beat 3 --model flux-schnell,flux-dev --try` runs
- **THEN** beat 3 gets two new attempts, one per model, from the same prompt
- **AND** its current image is unchanged

### Requirement: Verdicts SHALL be the user's

`attempt pick` and `attempt reject` SHALL be CLI-only. Each SHALL add a verdict line to `history.jsonl` that names the attempt; `attempt pick` SHALL also make that attempt the current one. `attempt report --by model` SHALL count attempts, kept attempts and cost per kept attempt, for each job and model.

#### Scenario: Picking the flux-dev attempt

- **WHEN** the user picks beat 3's flux-dev attempt
- **THEN** it becomes beat 3's image
- **AND** `attempt report --by model` counts one kept attempt for flux-dev

#### Scenario: An agent's tools

- **WHEN** an MCP client lists the tools
- **THEN** no tool records a verdict
