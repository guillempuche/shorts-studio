# Tasks

## 1. Previews

- [ ] 1.1 `preview --at`: the beat's image at `motionAt`, or its clip's frame through ffmpeg; refuse times outside the audio
- [ ] 1.2 Text drawn with the draft's own renderer: Takumi, or libass in a one-frame ffmpeg run
- [ ] 1.3 Compare previews with the same frames of a rendered draft, with both renderers; record the largest difference
- [ ] 1.4 `preview --slide`, `--cover` and `--sheet`; sheets of at most 24 labelled cells, grey cells for beats with no picture
- [ ] 1.5 Sizes: 540 px wide by default, sheets at most 1568 px, `--full`; each preview replaces the last of its kind in `previews/`
- [ ] 1.6 Operations whose output has a picture: registered with `McpServer.addTool` from the same operation list; the CLI prints the path

## 2. Problems as data

- [ ] 2.1 One problem shape in the domain, used by every check; captions named by word range and time, everything numbered from 0
- [ ] 2.2 `draft check`: reading limits after all fixes, layout boxes and safe zones, beats with no picture, captions across a beat change, emoji with ASS
- [ ] 2.3 `carousel check` and `layout check` use the same shape

## 3. Fixes

- [ ] 3.1 `caption fix --word N --text`, keeping the word's timing; refuse empty text
- [ ] 3.2 `caption fix --word N --drop`; drop a caption left with no words
- [ ] 3.3 `caption break --after-word N`, within the reading limits
- [ ] 3.4 Fixes stored apart from the transcript; dropped and reported when it changes; included in `captions.srt`
- [ ] 3.5 `slide set --slide N`, under the carousel's limits
- [ ] 3.6 The make-shorts skill: preview, check, fix, then render
