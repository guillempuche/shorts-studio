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

### Requirement: An animated clip SHALL fill its beat

`clip animate` SHALL ask the model for the shortest length it offers that covers the beat plus one frame, convert the result like an imported clip, and save it as the beat's clip with origin `ai` and its sound muted. A result up to 0.5 s short SHALL be saved with `hold`. When no length covers the beat, it SHALL refuse before spending, naming the beat and the longest length.

#### Scenario: A 6-second beat

- **WHEN** a model offers 5 s and 10 s clips and beat 0 lasts 6 s
- **THEN** `clip animate` asks for 10 s
- **AND** the draft shows the clip's first 6 s on beat 0

#### Scenario: A clip that arrives short

- **WHEN** beat 2 lasts 4.9 s, the model is asked for 5 s, and the clip arrives at 4.8 s
- **THEN** it's saved with `hold`, and its last frame fills the rest of the beat

### Requirement: An AI clip SHALL go stale with its image

An AI clip SHALL record the hash of the image it was made from. When the beat's image changes, the clip SHALL count as out of date: `post show` SHALL say so and `draft render` SHALL refuse it until it's animated again or removed.

#### Scenario: A rerolled image

- **WHEN** beat 0 was animated and then `image generate --beat 0 --reroll` runs
- **THEN** `post show` says beat 0's clip is out of date
