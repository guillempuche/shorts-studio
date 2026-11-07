## ADDED Requirements

### Requirement: Every paid call SHALL be priced by its units

A paid call's estimate SHALL be its units (megapixels, images, seconds, characters or minutes, rounded the way the provider bills) times the model's price per unit. Its ledger line SHALL record the units and the price per unit used. Transcription SHALL be reserved like any other paid call, but SHALL NOT need `--yes`.

#### Scenario: Transcribing a post

- **WHEN** `audio transcribe` runs on 2 minutes of audio, without `--yes`
- **THEN** the model's price for 2 minutes is reserved
- **AND** the transcript is written

#### Scenario: Transcription over the cap

- **WHEN** transcribing would pass the daily cap
- **THEN** it fails with `over-budget`
- **AND** nothing is sent to the provider

#### Scenario: An image billed by whole megapixels

- **WHEN** a 1344×2400 image is made with a model priced at $0.003 per megapixel, rounded up
- **THEN** $0.012 is reserved, for 4 megapixels

#### Scenario: A price changes

- **WHEN** a model's price is changed in `config.json`
- **THEN** earlier ledger lines keep the price they were made with
- **AND** `budget show` reports the same totals as before for those lines

### Requirement: A reservation SHALL be freed only when nothing was billed

A reservation SHALL be freed only when the provider refused the request (an HTTP 4xx) or reported the job failed. When the outcome is unknown, because the provider answered with a 5xx, the connection dropped or the command stopped mid-call, the reservation SHALL stay counted at its estimate.

#### Scenario: The connection drops while sending

- **WHEN** the connection drops before the provider answers a request
- **THEN** the reservation still counts toward the caps

#### Scenario: A server error while sending

- **WHEN** the provider answers a request with a 502
- **THEN** the reservation still counts toward the caps

#### Scenario: The provider refuses

- **WHEN** the provider answers that the key is wrong
- **THEN** the reservation is freed

### Requirement: Spending SHALL have a monthly cap

A paid call SHALL fail with `over-budget` when it would pass `caps.monthlyUsd`, as it does for the daily and per-post caps. `budget show` SHALL report this month's total against it. Days and months SHALL follow the machine's time zone.

#### Scenario: Near the end of the month

- **WHEN** this month's spending plus a call would pass the monthly cap
- **THEN** the call fails with `over-budget`
- **AND** the fix names `caps.monthlyUsd`

#### Scenario: Just after midnight

- **WHEN** a call is made at 00:30 local time
- **THEN** it counts toward the new day, even while UTC is still on the day before
