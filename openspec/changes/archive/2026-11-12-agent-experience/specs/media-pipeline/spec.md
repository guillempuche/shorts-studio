## MODIFIED Requirements

### Requirement: The CapCut export SHALL rebuild the draft with the same timing

`capcut export` SHALL work only on an approved draft that is up to date with the post's beats, images, captions and audio. It SHALL write one clip per beat, in order, each with its motion and exactly the frames that beat has in the draft. It SHALL also write the audio, `captions.srt`, a clean draft (without burned-in captions) and a README with the steps to follow in CapCut.

#### Scenario: Audio from someone else's reel

- **WHEN** the post's audio origin is `others`
- **THEN** no audio file is exported
- **AND** the clean draft has no audio track

#### Scenario: Frame counts

- **WHEN** the clips are placed back to back
- **THEN** they have as many frames as the draft

#### Scenario: A draft that isn't approved

- **WHEN** the CapCut export runs on a draft the user hasn't approved
- **THEN** nothing is exported
- **AND** it fails with code `needs-approval`

#### Scenario: Beats changed after approval

- **WHEN** a beat's story moment changes after the draft was approved
- **AND** the CapCut export runs
- **THEN** nothing is exported
- **AND** it fails with code `stale`
- **AND** the fix names `draft render`
