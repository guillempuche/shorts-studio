# Voice, music and animation

## Why

Posts without their own audio need a voice or music. An approved draft sometimes needs one moving shot, usually the hook.

## What Changes

- **A voice library** in `brand.json`. Each voice has a provider, a voice ID, the languages it speaks well and vibe tags (warm, serious, playful…). `voice search` finds voices in a provider's library and plays their samples; `voice add` saves one.
- **The script picks the voice.** `script.md` names its voice at the top, and a line can switch voice with `[voice: name]`, so one video can have several speakers. The voice is part of the script, so choosing it is part of approving the script.
- `audio voice` reads `script.md` aloud with each line's voice, following its emotion tags and pauses. Pace and emotion follow the story moment: faster on hooks, slower on vulnerable lines.
- `audio music` makes music with the ElevenLabs Music API. Suno and Fish have no public API for music, so their tracks come in through `source import --kind music`.
- Beats for music follow the start of each note or hit, or the tempo (BPM), found with aubio. If that isn't possible, beats fall back to equal lengths.
- `clip animate --beat` turns a beat's image into video with FAL, only for beats marked in review. It reserves its cost in the ledger, like images do.

Not part of this change: lip-sync.
