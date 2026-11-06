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
