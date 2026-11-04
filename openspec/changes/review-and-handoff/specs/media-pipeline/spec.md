## ADDED Requirements

### Requirement: The CapCut hand-off SHALL rebuild the draft without re-timing

`capcut export` SHALL write one clip per beat in order with its zoom applied, the audio, `captions.srt` and a draft without burned captions, so the draft can be rebuilt in CapCut desktop without re-timing beats.

#### Scenario: Audio from someone else's reel

- **WHEN** the post's audio origin is `others`
- **THEN** the exported draft has no audio track
