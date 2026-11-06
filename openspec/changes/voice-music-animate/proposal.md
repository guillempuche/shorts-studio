# Voice, music and animation

## Why

Posts without their own audio need a voice or music. An approved draft sometimes needs one moving shot, usually the hook.

## What Changes

- `audio voice` reads `script.md` aloud with Fish Audio or ElevenLabs, following its emotion tags and pauses.
- `audio music` makes music with the ElevenLabs Music API. Suno and Fish have no public API for music, so their tracks come in through `source import --kind music`.
- Beats for music follow the start of each note or hit, or the tempo (BPM), found with aubio. If that isn't possible, beats fall back to equal lengths.
- `clip animate --beat` turns a beat's image into video with FAL, only for beats marked in review. It reserves its cost in the ledger, like images do.

Not part of this change: lip-sync, audio with several speakers.
