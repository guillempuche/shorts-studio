# spend-budget Specification

## Purpose

Spend money only on what was approved, and never pay twice. This covers the script approval step, the spending ledger and its caps, dry runs, and resuming paid requests.

## Requirements

### Requirement: Paid calls SHALL reserve their cost within the caps

Each paid call SHALL reserve its estimated cost in the ledger before it is sent. Entries are only ever added to the ledger. Reserving SHALL happen under one lock that every process shares. The call SHALL fail with `over-budget` when it would pass the daily, monthly or per-post cap.

#### Scenario: Two calls at once

- **WHEN** two calls reserve at the same time
- **AND** each fits the cap on its own, but not both together
- **THEN** exactly one succeeds

### Requirement: A submitted request SHALL be resumed, not paid again

A command SHALL save the provider's request id and result URLs in `post.json` before it waits for the result. Sending a request and saving it SHALL finish together, even when the run is interrupted while sending. A later run SHALL check on that saved request instead of sending a new one. When the provider reports a request as failed, its reservation SHALL be released.

#### Scenario: Interrupted after sending

- **WHEN** a run is interrupted after it sends a request
- **AND** it runs again
- **THEN** the provider got one request
- **AND** the ledger holds one reservation

#### Scenario: Interrupted while sending

- **WHEN** a run is interrupted while the provider is still answering a request
- **THEN** the request is saved in `post.json` once the provider answers
- **AND** the next run resumes it instead of sending another

### Requirement: A dry run SHALL spend nothing

With `--dry-run`, or without `--yes` on a CLI command that needs it, a spending command SHALL report what it would make and the estimated cost. It SHALL change nothing. Transcription SHALL take a dry run, but SHALL NOT need `--yes`.

#### Scenario: Without --yes

- **WHEN** `image generate` runs without `--yes`
- **THEN** it prints the estimate
- **AND** it exits 3

#### Scenario: A transcription dry run

- **WHEN** `audio transcribe --dry-run` runs on 2 minutes of audio
- **THEN** it prints the price of 2 minutes
- **AND** nothing is reserved or sent

### Requirement: Spending SHALL be easy to see

`budget show` SHALL report today's spending against the daily cap, this month's against the monthly cap, and each post's total against the per-post cap. Reservations that are not settled yet SHALL count at their estimate.

#### Scenario: After generating images

- **WHEN** a post's images were generated today
- **THEN** today's total and the post's total include their cost

### Requirement: Images SHALL be made only from what the user approved

`script approve` SHALL record the script's hash, the audio's hash and every beat's image prompt. `image generate` SHALL refuse with code `needs-confirmation` while any of them differs from what was approved, and SHALL send nothing. Transcription is the only paid call allowed before approval.

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

### Requirement: A model's fields SHALL NOT change what a call is billed for

The fields a model sends with every request SHALL NOT change the size or number of images a request makes, its seed or its prompt. The provider SHALL send the ones the estimate was made for.

#### Scenario: A config.json model asks for four images

- **WHEN** a model in `config.json` sets `num_images: 4` in its options
- **AND** a beat's image is generated
- **THEN** the provider is asked for one image
- **AND** one image is reserved

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

#### Scenario: A request resumed after a price change

- **WHEN** a request sent at one price is resumed after the model's price changed
- **THEN** it settles at the price it was sent at

### Requirement: A reservation SHALL be freed only when nothing was billed

A reservation SHALL be freed only when nothing was billed: the provider refused the request (an HTTP 4xx) or reported the job failed, or the call stopped before anything was sent, such as on a missing key. When the outcome is unknown, because the provider answered with a 5xx, the connection dropped or the command stopped mid-call, the reservation SHALL stay counted at its estimate. A result that was paid for SHALL be kept even when its ledger line can't be closed.

#### Scenario: The connection drops while sending

- **WHEN** the connection drops before the provider answers a request
- **THEN** the reservation still counts toward the caps

#### Scenario: A server error while sending

- **WHEN** the provider answers a request with a 502
- **THEN** the reservation still counts toward the caps

#### Scenario: The provider refuses

- **WHEN** the provider answers that the key is wrong
- **THEN** the reservation is freed

#### Scenario: The ledger can't be closed

- **WHEN** a paid call succeeds but its ledger line can't be written
- **THEN** its result is kept
- **AND** its reservation counts in full

### Requirement: Spending SHALL have a monthly cap

A paid call SHALL fail with `over-budget` when it would pass `caps.monthlyUsd`, as it does for the daily and per-post caps. `budget show` SHALL report this month's total against it. Days and months SHALL follow the machine's time zone.

#### Scenario: Near the end of the month

- **WHEN** this month's spending plus a call would pass the monthly cap
- **THEN** the call fails with `over-budget`
- **AND** the fix names `caps.monthlyUsd`

#### Scenario: Just after midnight

- **WHEN** a call is made at 00:30 local time
- **THEN** it counts toward the new day, even while UTC is still on the day before

#### Scenario: A post made just after midnight

- **WHEN** a post is created at 00:30 local time
- **THEN** its slug starts with the new day's date
- **AND** `--day today` picks it

### Requirement: A total that lands on a cap SHALL fit it

A total exactly on a cap SHALL fit it, whatever floating-point sums make of it. A call priced below zero SHALL be refused, with nothing written.

#### Scenario: The 50th image on a $2 post

- **WHEN** 49 images at $0.04 were reserved for a post with a $2 cap
- **AND** a 50th is reserved
- **THEN** it goes through

### Requirement: The error SHALL name the cap that waiting fixes last

When a call would pass several caps, the error SHALL name the post's cap first, then the month's, then the day's. It SHALL tell the user to wait only for a day's or a month's cap above $0.

#### Scenario: Every cap would be passed

- **WHEN** a call would pass the daily, monthly and per-post caps
- **THEN** it fails with `over-budget`
- **AND** the fix names `caps.postUsd` and doesn't say to wait

### Requirement: The ledger SHALL be read strictly

A ledger line whose time isn't written as commands write it, or whose amount is below zero, SHALL make the read fail, naming the line and the form to use.

#### Scenario: A hand-edited time

- **WHEN** a ledger line's time is written as `2026-11-03T20:00:00-05:00`
- **THEN** reading the ledger fails, naming that line

### Requirement: Days SHALL come from one clock reading in a known zone

A command SHALL read the clock once, so a day and its total come from the same instant. TZ SHALL be read in its POSIX forms too (`:Europe/Madrid`, `:/etc/localtime`). When it names no time zone, days and months SHALL follow UTC, and `doctor` SHALL warn about TZ without failing.

#### Scenario: TZ names no zone

- **WHEN** TZ is `Mars/Base`
- **THEN** days and months follow UTC
- **AND** `doctor` warns, naming TZ and what it was set to, and still passes
