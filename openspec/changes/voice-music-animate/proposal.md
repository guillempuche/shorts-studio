# Voice, music and animation

## Why

Posts without their own audio need a voice or music. An approved draft sometimes needs one moving shot, usually the hook.

## What Changes

- **A voice library** in `brand.json`. Each voice has a provider, a voice ID, the languages it speaks well and vibe tags (warm, serious, playful…). `voice search` finds voices in a provider's library and plays their samples; `voice add` saves one.
- **The script picks the voice.** `script.md` names its voice at the top, and a line can switch voice with `[voice: name]`, so one video can have several speakers. The voice is part of the script, so choosing it is part of approving the script.
- `audio voice` reads `script.md` aloud with each line's voice, following its emotion tags and pauses. Pace and emotion follow the story moment: faster on hooks, slower on vulnerable lines.
- `audio music` makes music with the ElevenLabs Music API. Suno and Fish have no public API for music, so their tracks come in through `source import --kind music`.
- Beats for music follow the start of each note or hit, or the tempo (BPM), found with aubio. If that isn't possible, beats fall back to equal lengths.
- `clip animate --beat` turns a beat's image into video with FAL, only for beats marked in review.
  - **Marks outlive renders.** A mark from `post review --animate` records its beat's first and last frame, and stays valid while that beat keeps them, even after the draft is rendered again. A beat cut differently no longer counts as marked, so an old number can't animate another moment.
  - **Long enough.** It asks the model for the shortest length it offers that covers the beat plus one frame. Models usually make fixed lengths such as 5 or 10 s. A clip that arrives up to 0.5 s short of the beat is saved with `hold`, not thrown away after being paid for.
  - **Cost.** It reserves the cost of the length it asks for, not of the beat, because that's what the provider bills.
  - **Where the clip goes.** The result goes through the same conversion as an imported clip, and into the beat's clip slot from video-beats, with origin `ai`, muted. Drafts, previews and the CapCut export use it like any other clip, so this change builds on video-beats.
  - **Staleness.** An AI clip records the hash of the image it came from. When that image is made again, the clip is out of date: `post show` says so, and `draft render` refuses it until it's animated again or removed.
- Voice, music and clips reserve their cost like images do, priced by their units from the models list: voice by character, music by minute, clips by second. This builds on the models-and-prices change.

Not part of this change: lip-sync.
