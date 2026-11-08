## REMOVED Requirements

### Requirement: Nothing SHALL be spent before the script is approved

**Reason**: Transcription is paid and runs before the script exists, and approval covered only the script text, so prompts and audio could change after it.
**Migration**: Replaced by "Images SHALL be made only from what the user approved". Posts approved before this change need `script approve` again.

## ADDED Requirements

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

## MODIFIED Requirements

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
