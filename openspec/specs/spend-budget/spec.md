# spend-budget Specification

## Purpose

Spending only what was approved, never twice: the script approval gate, the spend ledger and its caps, dry runs, and resuming paid requests.

## Requirements

### Requirement: Nothing SHALL be spent before the script is approved

`image generate` SHALL refuse with code `needs-confirmation` while the post's current script hash isn't the approved one.

#### Scenario: Script edited after approval

- **WHEN** images are generated
- **THEN** nothing reaches the provider and the fix names `script approve`

### Requirement: Paid calls SHALL be reserved against caps

Each paid call SHALL reserve its estimated cost in the append-only ledger under a lock shared by every process before it is submitted, and SHALL fail with `over-budget` when the daily or per-post cap would be passed.

#### Scenario: Two calls at once

- **WHEN** two calls that each fit the cap but not together reserve at the same time
- **THEN** exactly one succeeds

### Requirement: A submitted request SHALL be resumed, not paid again

The provider's request id and result URLs SHALL be saved in `post.json` before polling, and a later run SHALL poll that request instead of submitting a new one. A request the provider reports as failed SHALL release its reservation.

#### Scenario: Interrupted after submitting

- **WHEN** a run is interrupted after submitting and runs again
- **THEN** the provider saw one request and the ledger holds one reservation

### Requirement: A dry run SHALL spend nothing

With `--dry-run` (or without `--yes` on the CLI) a spending command SHALL report what it would make and the estimated cost, and SHALL change nothing.

#### Scenario: Without --yes

- **WHEN** `image generate` runs without `--yes`
- **THEN** it prints the estimate and exits 3
