## ADDED Requirements

### Requirement: Animation SHALL be limited to beats chosen in review

`clip animate` SHALL only animate beats the user marked in `post review`. A mark SHALL record its beat's first and last frame and count while the beat keeps them, across later renders. It SHALL reserve the cost of the length it asks the model for, then resume and settle it the same way image generation does.

#### Scenario: An unmarked beat

- **WHEN** `clip animate` is asked for a beat not marked in review
- **THEN** it refuses with code `needs-confirmation`

#### Scenario: Marks after a new render

- **WHEN** beats 0 and 7 were marked, beat 0 was animated and the draft rendered again
- **THEN** `clip animate --beat 7` still runs

#### Scenario: A beat cut differently

- **WHEN** beat 7 was marked and a re-cut changes beat 7's frames
- **THEN** `clip animate --beat 7` refuses with code `needs-confirmation`

### Requirement: Voice and music SHALL reserve their cost

`audio voice` and `audio music` SHALL reserve their estimated cost before each call, priced by the voice's characters or the music's length, and settle it when the audio arrives. A dry run SHALL show the estimate for the whole script or track.

#### Scenario: A dry run of the voice-over

- **WHEN** `audio voice` runs without `--yes` on a 900-character script
- **THEN** it prints the estimate for 900 characters with each line's voice
- **AND** nothing is sent or reserved
