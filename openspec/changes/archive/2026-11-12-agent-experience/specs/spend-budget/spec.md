## MODIFIED Requirements

### Requirement: A dry run SHALL spend nothing

With `--dry-run`, or without `--yes` on a CLI command that needs it, a spending command SHALL report what it would make, the estimated cost, and whether the estimate fits the caps, counting what a batch dry run planned for earlier posts; when it doesn't, it SHALL name the cap that stops it. It SHALL change nothing. Transcription SHALL take a dry run, but SHALL NOT need `--yes`.

#### Scenario: Without --yes

- **WHEN** `image generate` runs without `--yes`
- **THEN** it prints the estimate
- **AND** it exits 3

#### Scenario: A transcription dry run

- **WHEN** `audio transcribe --dry-run` runs on 2 minutes of audio
- **THEN** it prints the price of 2 minutes
- **AND** nothing is reserved or sent

#### Scenario: A dry run that wouldn't fit

- **WHEN** `image generate --dry-run` estimates more than is left of today's cap
- **THEN** its result says the estimate doesn't fit
- **AND** it names `caps.dailyUsd`
- **AND** it exits 0

### Requirement: Images SHALL be made only from what the user approved

`script approve` SHALL record the script's hash, the audio's hash and every beat's image prompt. `image generate` SHALL refuse with code `needs-approval` while any of them differs from what was approved, and SHALL send nothing. Transcription is the only paid call allowed before approval.

#### Scenario: Script edited after approval

- **WHEN** images are generated
- **THEN** nothing is sent to the provider
- **AND** the fix names `script approve`

#### Scenario: A prompt rewritten after approval

- **WHEN** a beat's prompt changes after the script was approved
- **AND** images are generated
- **THEN** nothing is sent to the provider
- **AND** `next` names `script approve`

#### Scenario: New audio after approval

- **WHEN** new audio is imported after the script was approved
- **THEN** the post is no longer approved

### Requirement: The error SHALL name the cap that waiting fixes last

When a call would pass several caps, the error SHALL name the post's cap first, then the month's, then the day's. It SHALL tell the user to wait only for a day's or a month's cap above $0, and SHALL say that raising a cap is the user's decision, not tell the reader to raise it.

#### Scenario: Every cap would be passed

- **WHEN** a call would pass the daily, monthly and per-post caps
- **THEN** it fails with `over-budget`
- **AND** the fix names `caps.postUsd` and doesn't say to wait
- **AND** the fix says raising it is the user's decision

## ADDED Requirements

### Requirement: Spending SHALL stop while the settings aren't valid

When `config.json`, `brand.json` or a `SHORTS_*` variable can't be used, a paid call SHALL fail before it reserves or sends anything, since its caps aren't known, and a dry run SHALL say its estimate doesn't fit. Other commands SHALL still run, with a warning on stderr that names the problem.

#### Scenario: A bad setting next to lowered caps

- **WHEN** config.json sets `caps.dailyUsd` to 0.5 and `captions.fontSize` to `"big"`
- **AND** `audio transcribe` runs
- **THEN** nothing is reserved or sent
- **AND** the fix names `doctor`

#### Scenario: A command that spends nothing

- **WHEN** `budget show` runs with the same config.json
- **THEN** it runs
- **AND** stderr names config.json and the problem
