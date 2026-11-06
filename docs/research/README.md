# Research: how pacing, motion, sound and text shape a short video's story

This is the evidence behind shorts-studio's story-direction defaults. Each note lists rules, how strong the evidence for each one is, and where it comes from. The numbers the code uses live in [`src/domain/direction.ts`](../../src/domain/direction.ts). The [story-direction skill](../../.agents/skills/story-direction/SKILL.md) shows how an agent applies them.

| Note                       | Covers                                                                           |
| -------------------------- | -------------------------------------------------------------------------------- |
| [pacing.md](pacing.md)     | Shot length, cut rhythm, the hook window, cutting on a word or a pause           |
| [motion.md](motion.md)     | Zoom, push-in and pull-back, pans and drifts, stillness, transitions             |
| [sound.md](sound.md)       | Cutting to music, tempo and key, voice speed, pauses, ducking and loudness       |
| [captions.md](captions.md) | Reading speed, caption grouping, word highlight, emphasis, safe zones, hook text |

**Evidence strength** is one of:

- _strong_: standards, studies others repeated, or studies of large collections.
- _moderate_: single or small studies, or data the platforms publish.
- _weak_: vendor claims, or untested extrapolation.
- _lore_: common practice that nobody measured.

**One caveat applies to all four.** Most evidence comes from feature films, broadcast TV, lab studies or platform ad research. None of it measured 60-second vertical videos made of still images. So every number here is a starting point to test, not a law. Researched in November 2026.
