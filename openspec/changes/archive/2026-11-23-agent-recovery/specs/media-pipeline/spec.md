## ADDED Requirements

### Requirement: Imported files SHALL be checked by what they hold

`image import` SHALL take only a file whose content is a JPEG, PNG or WebP image, whatever its name. `source import` SHALL refuse with `usage` a folder, a file ffmpeg can't read, a file with no audio track, and audio that is silent throughout. Each refusal SHALL name the file given, never a temporary file, and change nothing.

#### Scenario: Text named as an image

- **WHEN** `image import --beat 0 --file notes.png` runs and notes.png holds text
- **THEN** it exits 2
- **AND** beat 0 keeps the image it had

#### Scenario: A folder

- **WHEN** `source import --file <folder>` runs
- **THEN** it exits 2
- **AND** the message names that folder

#### Scenario: A video with no sound

- **WHEN** `source import` gets a video file with no audio track
- **THEN** it exits 2
- **AND** the message says the file has no audio track
- **AND** no message names `audio.tmp.m4a`

#### Scenario: Silence

- **WHEN** `source import` gets audio that is silent from start to end
- **THEN** it exits 2
- **AND** the post's audio is unchanged
