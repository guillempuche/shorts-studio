## ADDED Requirements

### Requirement: Music SHALL get beats from its rhythm

For audio of kind `music`, `beat plan` SHALL place beats at the start of each note or hit, or on the music's beat, when a detector for them is available. Otherwise it SHALL cut the audio into beats of equal length.

#### Scenario: No detector installed

- **WHEN** aubio isn't installed
- **THEN** the plan uses beats of equal length
- **AND** it says so
