## ADDED Requirements

### Requirement: A clip beat SHALL record what it was made from

A beat's clip SHALL record its working copy, the original file's hash, its start, focus, sound, hold and origin (`mine`, `others`, `ai`). All of them SHALL be part of the draft's input hash. A clip beat SHALL refuse a motion override.

#### Scenario: A new start

- **WHEN** beat 3's clip start changes from 2.5 s to 1 s
- **THEN** the draft is out of date

#### Scenario: Motion on a clip beat

- **WHEN** `beat set --beat 3 --motion push-slow` runs and beat 3 has a clip
- **THEN** it exits 2, saying clip beats don't move

### Requirement: Clips from others SHALL be named

`post show` and the CapCut export's README SHALL name every beat whose clip has origin `others`.

#### Scenario: Footage from a saved reel

- **WHEN** beat 2's clip came from someone else's reel
- **THEN** `post show` names beat 2 as using someone else's video
