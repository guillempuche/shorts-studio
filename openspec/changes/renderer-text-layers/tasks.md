# Tasks

## 1. Groundwork

- [ ] 1.1 `motionAt` in the domain, with tests; ffmpeg's zoompan expressions built from the same numbers
- [ ] 1.2 `textAt` in the domain: caption, pop-in and hook per whole frame, and the words spoken so far when highlight is on; tests at frames that fall on exact times (3.3 s) and between frames (3.316 s)
- [ ] 1.3 `toAss` snaps every time to whole frames
- [ ] 1.4 A `Renderer` port; `MediaTools` keeps `duration`, `extractAudio` and `copyAudio`
- [ ] 1.5 Draft jobs carry caption groups, style and hook; the ffmpeg provider calls `toAss` itself
- [ ] 1.6 `render.text` (`ass` or `takumi`, default `ass`) in settings and `config.schema.json`
- [ ] 1.7 The draft records its text renderer, Takumi version and look hash (layout, look values, font file bytes with fallbacks)
- [ ] 1.8 Split the draft's input hash into the post's own inputs and the look; `capcut export` checks only the first

## 2. Takumi

- [ ] 2.1 `@takumi-rs/core` at an exact version; draw each distinct text state once, from a layout
- [ ] 2.2 Pipe raw frames into the draft's ffmpeg run; blend as `yuva420p` over `yuv420`, only in the layout's text band
- [ ] 2.3 Exactly the draft's frame count; no Takumi when there's no text
- [ ] 2.4 Words and the hook passed as text, never markup; test `<`, `&`, quotes and emoji
- [ ] 2.5 Outline as its own layer under the letters
- [ ] 2.6 `eof_action=endall`; fail when fewer frames were sent than the draft has; stop ffmpeg on cancel
- [ ] 2.7 `capcut/text-overlay.mov` (ProRes 4444) only when renderer, version and look hash match the draft; otherwise leave it out and say why
- [ ] 2.8 Check that CapCut desktop imports the overlay with transparency
- [ ] 2.9 Reference pictures for each caption layout, checked in tests and before any Takumi upgrade

## 3. Languages

- [ ] 3.1 Test captions in Catalan, Spanish, Arabic (right to left), Hindi and Japanese against libass; record what Takumi gets wrong
- [ ] 3.2 Make `takumi` the default only when 3.1 passes, in a later change

## 4. Packaging and checks

- [ ] 4.1 Bun binaries: a direct `require` of the native file for each target platform
- [ ] 4.2 Nix: check the package renders on Linux with no network
- [ ] 4.3 `doctor` checks Takumi always: a failure with `takumi`, a warning with `ass`
- [ ] 4.4 Drawing commands fail with `missing-tool` when Takumi doesn't load
- [ ] 4.5 Docs: architecture, providers, and the README's comparison table
