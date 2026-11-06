## ADDED Requirements

### Requirement: Music SHALL get beats from its rhythm

For audio of kind `music`, `beat plan` SHALL place beats at the start of each note or hit, or on the music's beat, when a detector for them is available. Otherwise it SHALL cut the audio into beats of equal length.

#### Scenario: No detector installed

- **WHEN** aubio isn't installed
- **THEN** the plan uses beats of equal length
- **AND** it says so

### Requirement: The script SHALL choose its voices

`audio voice` SHALL read each line with the voice the script names for it, from the voice library in `brand.json`. It SHALL refuse a voice that isn't in the library or doesn't list the post's language.

#### Scenario: Two speakers

- **WHEN** the script names `deep-narrator` and one line says `[voice: bright-young]`
- **THEN** that line is spoken by `bright-young` and the rest by `deep-narrator`

#### Scenario: Changing the voice after approval

- **WHEN** the script's voice changes after it was approved
- **THEN** the script needs approving again before any audio is made
