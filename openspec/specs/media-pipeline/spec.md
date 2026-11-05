# media-pipeline Specification

## Purpose

From audio to a reviewable draft: import, word-timed transcription, beats, one image per beat, and an FFmpeg render with burned-in captions.

## Requirements

### Requirement: Imported audio SHALL be normalised

`source import` SHALL convert any audio or video file to `audio/audio.m4a`, record its duration and hash, and record its origin (`mine`, `others`, `ai`) and kind (`speech`, `music`).

#### Scenario: A video export

- **WHEN** an MP4 is imported
- **THEN** only its audio track is kept, as AAC in `audio/audio.m4a`

### Requirement: Transcripts SHALL carry word timings

`audio transcribe` SHALL store every word with its start and end, auto-detect the language unless one is given, and skip when the transcript is up to date.

#### Scenario: Re-running

- **WHEN** it runs again with the same audio and language
- **THEN** nothing is sent to the provider

### Requirement: Beats SHALL cover the audio at phrase boundaries

`beat plan` SHALL cut speech into contiguous beats of about 1.5–3 s at pauses or sentence ends, from 0 to the end of the audio, and audio without words into an even grid. Replanning a plan that has prompts SHALL need `--force`.

#### Scenario: Continuous speech

- **WHEN** beats are planned for steady speech
- **THEN** every beat but the last lasts 1.5 to about 3 seconds and they leave no gaps

### Requirement: Drafts SHALL stay in sync with the audio

`draft render` SHALL produce a 1080×1920, 30 fps MP4 the length of the audio, giving each beat round(end·30) − round(start·30) frames, with word-group captions burned inside the bottom safe zone, and SHALL also write `captions.srt`.

#### Scenario: Frame counts

- **WHEN** beat boundaries fall between frames
- **THEN** the frames still add up to the audio's length

### Requirement: Beat lengths SHALL follow the story moment

`beat plan --by-moment` SHALL re-cut the audio so that the beats of each moment fall within that moment's length range, still cutting at word boundaries and covering the whole audio. It SHALL keep each beat's moment and drop its prompt.

#### Scenario: A vulnerable stretch

- **WHEN** a stretch of speech is marked `vulnerable` and re-cut
- **THEN** its beats last about 4–6 seconds where the words allow

### Requirement: Motion SHALL follow the story moment

Each beat SHALL move with the motion its moment calls for, or with its override, from a fixed vocabulary, and SHALL never move past the image's edges.

#### Scenario: A twist

- **WHEN** a beat's moment is `twist`
- **THEN** it punches in within about half a second and then holds

#### Scenario: No moment

- **WHEN** a beat has no moment
- **THEN** it pushes in slowly, in the same direction as its neighbours

### Requirement: Captions SHALL respect reading limits and safe zones

Captions SHALL show at most 4 words, about 42 characters and 17 characters per second, stay up at least 0.8 s, never leave a single word alone unless it ends the audio, and sit clear of the bottom 672 px and the right-hand 140 px of a 1080×1920 frame.

#### Scenario: A lone last word

- **WHEN** grouping would leave one word on its own mid-sentence
- **THEN** it joins the caption before it

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
