# Tasks

## 1. Groundwork

- [ ] 1.1 `motionAt` in the domain, with tests; ffmpeg's zoompan expressions built from the same numbers
- [ ] 1.2 `textAt` in the domain: caption, lit word, pop-in and hook per whole frame, with tests at frames that fall on exact times (3.3 s)
- [ ] 1.3 A `Renderer` port; `MediaTools` keeps `duration`, `extractAudio` and `copyAudio`
- [ ] 1.4 Draft jobs carry caption groups, style and hook; the ffmpeg provider calls `toAss` itself
- [ ] 1.5 `render.text` (`ass` or `takumi`, default `ass`) in settings and `config.schema.json`
- [ ] 1.6 The text renderer, layout and Takumi version in the draft's input hash

## 2. Takumi

- [ ] 2.1 `@takumi-rs/core` at an exact version; draw each distinct text state once, from a layout
- [ ] 2.2 Pipe raw frames into the draft's ffmpeg run; blend as `yuva420p` over `yuv420`, only in the layout's text band
- [ ] 2.3 Outline as its own layer under the letters
- [ ] 2.4 `eof_action=endall`; fail when fewer frames were sent than the draft has; stop ffmpeg on cancel
- [ ] 2.5 `capcut/text-overlay.mov` (ProRes 4444) in the CapCut export, and check that CapCut desktop imports it with transparency
- [ ] 2.6 Reference pictures for each caption layout, checked in tests and before any Takumi upgrade

## 3. Languages

- [ ] 3.1 Test captions in Catalan, Spanish, Arabic (right to left), Hindi and Japanese against libass; record what Takumi gets wrong
- [ ] 3.2 Make `takumi` the default only when 3.1 passes, in a later change

## 4. Packaging

- [ ] 4.1 Bun binaries: a direct `require` of the native file for each target platform
- [ ] 4.2 Nix: check the package renders on Linux with no network
- [ ] 4.3 `doctor` checks that Takumi loads when `render.text` is `takumi`
- [ ] 4.4 Docs: architecture, providers, and the README's comparison table
