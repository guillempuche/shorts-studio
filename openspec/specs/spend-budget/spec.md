# spend-budget Specification

## Purpose

Spend money only on what was approved, and never pay twice. This covers the script approval step, the spending ledger and its caps, dry runs, and resuming paid requests.

## Requirements

### Requirement: Nothing SHALL be spent before the script is approved

`image generate` SHALL refuse with code `needs-confirmation` while the hash of the post's current script is not the approved one.

#### Scenario: Script edited after approval

- **WHEN** images are generated
- **THEN** nothing is sent to the provider
- **AND** the fix names `script approve`

### Requirement: Paid calls SHALL reserve their cost within the caps

Each paid call SHALL reserve its estimated cost in the ledger before it is sent. Entries are only ever added to the ledger. Reserving SHALL happen under one lock that every process shares. The call SHALL fail with `over-budget` when it would pass the daily or per-post cap.

#### Scenario: Two calls at once

- **WHEN** two calls reserve at the same time
- **AND** each fits the cap on its own, but not both together
- **THEN** exactly one succeeds

### Requirement: A submitted request SHALL be resumed, not paid again

A command SHALL save the provider's request id and result URLs in `post.json` before it waits for the result. A later run SHALL check on that saved request instead of sending a new one. When the provider reports a request as failed, its reservation SHALL be released.

#### Scenario: Interrupted after sending

- **WHEN** a run is interrupted after it sends a request
- **AND** it runs again
- **THEN** the provider got one request
- **AND** the ledger holds one reservation

### Requirement: A dry run SHALL spend nothing

With `--dry-run`, or without `--yes` on the CLI, a spending command SHALL report what it would make and the estimated cost. It SHALL change nothing.

#### Scenario: Without --yes

- **WHEN** `image generate` runs without `--yes`
- **THEN** it prints the estimate
- **AND** it exits 3

### Requirement: Spending SHALL be easy to see

`budget show` SHALL report today's spending against the daily cap, and each post's total against the per-post cap. Reservations that are not settled yet SHALL count at their estimate.

#### Scenario: After generating images

- **WHEN** a post's images were generated today
- **THEN** today's total and the post's total include their cost
