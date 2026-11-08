## ADDED Requirements

### Requirement: Caption fixes SHALL keep word timings

`caption fix` SHALL change a word's text and keep its start and end. It SHALL refuse empty text; `--drop` SHALL remove the word instead, and a caption left with no words SHALL be dropped. `caption break` SHALL move where a caption ends only within the reading limits. Fixes SHALL be stored apart from the transcript, keyed to its hash, and be part of the draft's input hash and `captions.srt`.

#### Scenario: A misspelt name

- **WHEN** `caption fix --word 41 --text Cristina` runs and the draft is rendered again
- **THEN** word 41 shows as "Cristina" at the same frames as before

#### Scenario: A filler word

- **WHEN** `caption fix --word 7 --drop` runs on "um"
- **THEN** no caption shows word 7

### Requirement: Fixes SHALL be checked together

Every render and `draft check` SHALL apply all caption fixes and breaks together and check the result against the reading limits, reporting each caption that breaks them.

#### Scenario: A longer word after a break

- **WHEN** a break joins two words into one caption and a fix then makes it 45 characters
- **THEN** `draft check` reports that caption as over the 42-character limit

### Requirement: Fixes SHALL never land on the wrong words

When a post's transcript changes, its caption fixes SHALL be dropped, not applied. `post show` SHALL say how many were dropped.

#### Scenario: New audio

- **WHEN** the audio is replaced and transcribed again
- **THEN** the old caption fixes no longer apply
- **AND** `post show` says they were dropped
