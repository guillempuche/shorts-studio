## ADDED Requirements

### Requirement: The CapCut hand-off SHALL rebuild the draft without re-timing

`capcut export` SHALL write, for an approved draft only, one clip per beat in order with its motion applied and exactly the frames that beat has in the draft, the audio, `captions.srt`, a draft without burned captions and a README with the CapCut steps.

#### Scenario: Audio from someone else's reel

- **WHEN** the post's audio origin is `others`
- **THEN** no audio file is exported and the clean draft has no audio track

#### Scenario: Frame counts

- **WHEN** the clips are laid end to end
- **THEN** they hold as many frames as the draft

### Requirement: Imported images SHALL be kept

An image attached to a beat with `image import` SHALL be kept by `image generate` unless that beat is rerolled.

#### Scenario: Generating the other beats

- **WHEN** beat 0 has an imported image and images are generated
- **THEN** only the other beats are sent to the provider
