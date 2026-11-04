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
