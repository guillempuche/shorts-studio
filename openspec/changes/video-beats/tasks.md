# Tasks

## 1. Clips on beats

- [ ] 1.1 A beat's clip in `post.json`: working copy, original's hash, start, focus, sound, hold, origin
- [ ] 1.2 `clip import --beat N --file`, with `--from`, `--focus`, `--sound`, `--origin` and `--hold`; refuse files with no video
- [ ] 1.3 Convert once: upright, 30 fps steady, SDR, scaled so a 1080×1920 crop fits, at most 60 s from the start; report landscape and enlarged clips; share copies with the same original and start
- [ ] 1.4 HDR to SDR with `zscale`; `missing-tool` without it or when it can't convert; `doctor` warns when ffmpeg lacks it
- [ ] 1.5 Refuse a clip shorter than its beat, naming the fixes; check again in `draft render`
- [ ] 1.6 Clip beats need no image or prompt: draft, export and next step; `image generate` skips them unless named
- [ ] 1.7 Re-cutting keeps clips on beats with the same first frame, names the dropped ones, keeps their copies
- [ ] 1.8 Refuse `beat set --motion` on clip beats

## 2. Drafts and export

- [ ] 2.1 The renderer takes clip beats: start, crop at the focus, exactly the beat's frames
- [ ] 2.2 Sound: muted by default, `under` at a fixed level, never from origin `others`, none with `--mute`
- [ ] 2.3 Clips in the draft's input hash
- [ ] 2.4 The CapCut export writes clip beats frame for frame; its README names clips from others
- [ ] 2.5 `post show` names beats with clips from others
- [ ] 2.6 Stills of clip beats (previews, sheets, covers, slides) from the clip's frame

## 3. Checks

- [ ] 3.1 Test clips: rotated, 60 fps, variable frame rate, HDR (HLG, Dolby Vision 8.4 and 5), landscape, 720p, a 10-minute 4K file, shorter than the beat
- [ ] 3.2 Measure a draft with 10 clip beats against 10 picture beats: time and memory
