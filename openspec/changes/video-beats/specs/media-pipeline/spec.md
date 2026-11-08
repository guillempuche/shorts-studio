## ADDED Requirements

### Requirement: A beat SHALL show an image or a clip

When a beat has a clip, the draft SHALL show the clip from its start, cropped to 1080×1920 at its focus, with no zoom or pan, for exactly the beat's frames: round(end·30) − round(start·30). A beat with a clip SHALL need no image or prompt. A beat without a clip SHALL show its image as today.

#### Scenario: A clip on beat 3

- **WHEN** beat 3 has a clip starting at 2.5 s and the draft is rendered
- **THEN** beat 3 shows the clip from 2.5 s for exactly beat 3's frames
- **AND** the other beats show their images with their motion

#### Scenario: Footage only

- **WHEN** every beat has a clip and none has an image
- **THEN** `draft render` renders the draft

### Requirement: Images SHALL NOT be paid for on clip beats

`image generate` SHALL skip beats that have a clip, unless a beat is named with `--beat`.

#### Scenario: A post with some clips

- **WHEN** beats 2 and 5 have clips and `image generate` runs with `--yes`
- **THEN** no image is requested for beats 2 and 5

### Requirement: Imported clips SHALL be converted once

`clip import` SHALL convert a clip once into a working copy: upright, 30 fps at a steady rate, standard dynamic range, scaled so a 1080×1920 crop fits whole, from its start to at most 60 s later. HDR footage SHALL be converted with `zscale`; when ffmpeg lacks it, or can't convert it, the import SHALL fail with code `missing-tool` and its fix. A file with no video SHALL be refused.

#### Scenario: An iPhone clip in HDR

- **WHEN** an HLG clip recorded at 60 fps is imported
- **THEN** its working copy is SDR at 30 fps

#### Scenario: A landscape clip

- **WHEN** a 1920×1080 clip is imported
- **THEN** its working copy is at least 1080 wide and 1920 tall after scaling
- **AND** `clip import` reports that the crop keeps about a third of the width

### Requirement: A clip SHALL cover its beat

A clip SHALL last at least from its start to the end of its beat, unless `--hold` was given, which keeps its last frame for the rest of the beat. `clip import` and `draft render` SHALL refuse a clip that's too short, naming the beat and the fixes.

#### Scenario: A beat that grew

- **WHEN** a re-cut keeps beat 3's clip on a beat that now lasts 5 s, and the clip has 4 s left after its start
- **THEN** `draft render` exits 1
- **AND** the fix names an earlier start, a shorter beat or `--hold`

### Requirement: Cutting the beats again SHALL keep clips only where they still start

When beats are cut again, a clip SHALL stay on the new beat that starts on the same frame as its old beat, and every other clip SHALL be dropped, with the command naming them. Working copies SHALL stay in `clips/`.

#### Scenario: Re-cut by moment

- **WHEN** beat 3 had a clip and no new beat starts on beat 3's old first frame
- **THEN** `beat plan --by-moment --force` names beat 3's clip as dropped
- **AND** its working copy is still in `clips/`

### Requirement: A clip's own sound SHALL be muted unless asked for

A clip's sound SHALL be left out of the draft unless the beat says `under`, which mixes it under the post's audio at a fixed level. Sound from a clip with origin `others` SHALL never be used, and `capcut export --mute` SHALL leave out every clip's sound.

#### Scenario: Ambient sound

- **WHEN** beat 5's clip is set to `under`
- **THEN** its sound plays during beat 5, quieter than the voice
