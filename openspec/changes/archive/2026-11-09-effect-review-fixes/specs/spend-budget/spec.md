## MODIFIED Requirements

### Requirement: A reservation SHALL be freed only when nothing was billed

A reservation SHALL be freed only when nothing was billed: the provider refused to take the request (an HTTP 4xx) or reported the job failed, or the call stopped before anything was sent, such as on a missing key. When the outcome is unknown, because the provider answered with a 5xx, the connection dropped or the command stopped mid-call, the reservation SHALL stay counted at its estimate. A result that was paid for SHALL be kept even when its ledger line can't be closed.

#### Scenario: The connection drops while sending

- **WHEN** the connection drops before the provider answers a request
- **THEN** the reservation still counts toward the caps

#### Scenario: A server error while sending

- **WHEN** the provider answers a request with a 502
- **THEN** the reservation still counts toward the caps

#### Scenario: The provider refuses

- **WHEN** the provider answers that the key is wrong
- **THEN** the reservation is freed

#### Scenario: A 4xx about a job already taken

- **WHEN** the provider answers 404 while an accepted request's result is being collected
- **THEN** the reservation still counts toward the caps

#### Scenario: The ledger can't be closed

- **WHEN** a paid call succeeds but its ledger line can't be written
- **THEN** its result is kept
- **AND** its reservation counts in full

## ADDED Requirements

### Requirement: Waiting on a provider SHALL have a limit

Each check on a sent request SHALL give up after 30 seconds, and downloading its result after 2 minutes, failing with code `provider`. The request SHALL stay saved, so the next run resumes it without paying again.

#### Scenario: A connection that stalls

- **WHEN** the provider stops answering while an image's status is checked
- **THEN** the run fails with code `provider` within about 30 seconds
- **AND** the next run checks on the same request
