## ADDED Requirements

### Requirement: Caption fixes SHALL keep word timings

`caption fix` SHALL change a word's text and keep its start and end. `caption break` SHALL move where a caption ends only within the reading limits. Both SHALL be stored apart from the transcript, keyed to its hash, and SHALL be part of the draft's input hash.

#### Scenario: A misspelt name

- **WHEN** `caption fix --word 41 --text Cristina` runs and the draft is rendered again
- **THEN** word 41 shows as "Cristina" at the same frames as before

### Requirement: Fixes SHALL never land on the wrong words

When a post's transcript changes, its caption fixes SHALL be dropped, not applied. `post show` SHALL say how many were dropped.

#### Scenario: New audio

- **WHEN** the audio is replaced and transcribed again
- **THEN** the old caption fixes no longer apply
- **AND** `post show` says they were dropped
