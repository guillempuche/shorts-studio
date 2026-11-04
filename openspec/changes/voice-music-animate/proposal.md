# Voice, music and animation

## Why

Posts without original audio need a voice or music, and an approved draft sometimes needs one moving shot, usually the hook.

## What Changes

- `audio voice` from `script.md` (Fish Audio, ElevenLabs), honouring emotion tags and pauses.
- `audio music` (ElevenLabs Music API); Suno and Fish music come in through `source import --kind music`, as neither has a public API for it.
- Music beats from onsets or BPM (aubio), with the even grid as fallback.
- `clip animate --beat` (FAL image-to-video) for beats marked in review, through the ledger like images.

Out of scope: lip-sync, multi-speaker audio.
