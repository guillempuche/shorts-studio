# Tasks

- [ ] 1.1 Voice library in `brand.json`; `voice search` and `voice add`
- [ ] 1.2 Voice named in `script.md`, with `[voice: name]` for several speakers
- [ ] 1.3 `audio voice` with Fish Audio and ElevenLabs providers, reserving cost by character
- [ ] 1.4 `audio music` with ElevenLabs, reserving cost by minute
- [ ] 1.5 Music beats with aubio, falling back to equal-length beats
- [ ] 1.6 `clip animate`, reserving cost in the ledger and resuming requests
- [ ] 1.7 Ask for the shortest model length that covers the beat plus one frame; reserve the cost of that length
- [ ] 1.8 Convert the result like an imported clip and save it in the beat's clip slot (video-beats) with origin `ai`; up to 0.5 s short is saved with `hold`
- [ ] 1.9 Review marks record the beat's first and last frame, and count while the beat keeps them
- [ ] 1.10 An AI clip records its source image's hash; out of date when the image changes
