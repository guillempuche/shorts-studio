# Story direction

## Why

Every beat is cut 1.5–3 s at word boundaries and zooms the same way, whatever the story is doing, so a hook, a vulnerable line and a payoff all look and pace alike. Research in [docs/research](../../../../docs/research/README.md) finds pacing, motion and caption timing should follow the story moment, and that captions currently sit inside Instagram Reels' and TikTok ads' bottom UI zone.

## What Changes

- Each beat can carry a story **moment** (`hook`, `setup`, `tension`, `twist`, `vulnerable`, `payoff`, `cta`) and a **motion** override, set with `beat set`.
- `beat plan --by-moment` re-cuts the audio so each moment's beats fall in that moment's length range.
- Drafts use a **motion vocabulary** (`hold`, `push-slow`, `push-punch`, `pull-back`, `pan-right`, `pan-left`, `drift-up`, `drift-down`) chosen from the moment, instead of alternating zooms.
- Images are generated about 25% larger than the frame for motion headroom.
- Captions follow reading limits (≤17 characters per second, ≤2 lines, ≥0.8 s, no lone word), move up clear of every platform's bottom zone, and can highlight word by word (off by default).
- An optional **hook title** (`script set --hook`) shows in the upper safe band at the start.
- A `story-direction` skill tells the agent how to choose moments and overrides.

Out of scope: sound defaults (ducking, loudness, beat-synced music cuts, voice speed) wait for voice-music-animate; transitions other than hard cuts.
