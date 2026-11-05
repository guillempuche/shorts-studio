# Research: how pacing, motion, sound and text shape a short video's story

The evidence behind shorts-studio's story-direction defaults. Each note lists rules with how strong their evidence is and where it comes from; the numbers the code uses live in [`src/domain/direction.ts`](../../src/domain/direction.ts), and how an agent applies them is the [story-direction skill](../../.agents/skills/story-direction/SKILL.md).

| Note                       | Covers                                                                           |
| -------------------------- | -------------------------------------------------------------------------------- |
| [pacing.md](pacing.md)     | Shot length, cut rhythm, the hook window, cutting on a word or a pause           |
| [motion.md](motion.md)     | Zoom, push-in and pull-back, pans and drifts, stillness, transitions             |
| [sound.md](sound.md)       | Cutting to music, tempo and mode, voice speed, pauses, ducking and loudness      |
| [captions.md](captions.md) | Reading speed, caption grouping, word highlight, emphasis, safe zones, hook text |

**Evidence strength** is one of: _strong_ (standards, replicated or large corpus studies), _moderate_ (single or small studies, platform-published data), _weak_ (vendor claims, untested extrapolation), _lore_ (practitioner convention without measurement).

**One caveat applies to all four.** Most evidence comes from feature films, broadcast TV, lab studies or platform ad research. None of it measured 60-second vertical videos made of still images, so every number here is a starting point to test, not a law. Researched in November 2026.
