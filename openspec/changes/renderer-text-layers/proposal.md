# Text layers with Takumi

## Why

Captions and the hook are ASS subtitles today. ASS can colour and fade text, but it can't make a caption pop in, put a shape behind a word, or lay out a carousel slide. Carousels and covers need text over pictures too, and they should look like the videos.

Two trials on the same 66 s post (M1 Pro) compared ways to draw text:

- **HyperFrames** (HeyGen, HTML to video through headless Chrome), 2026-11-07: every caption landed on its frame, but the draft took about 80 s instead of 24 s. It needed Chrome (a 193 MB download), 2.3–3.7 GB of extra memory, and a fontconfig file on Linux. Frames changed slightly with the worker count. It also swaps Arial and Helvetica for Inter from Google Fonts, on purpose.
- **Takumi** (Rust, MIT or Apache-2.0, HTML and CSS to pictures with no browser), 2026-11-08:
  - the whole draft took 26.9 s, against 23.2 s with ffmpeg alone, using about 150 MB of extra memory;
  - every caption and the hook landed on its frame, and two runs gave identical frames;
  - it looked the same as HyperFrames side by side;
  - it worked on Linux and under Nix's own Node, with no fontconfig and no network, and inside a Bun-compiled binary.

Remotion was dropped earlier: it needs React and a bundle step, brings its own ffmpeg and Chrome, and doesn't support NixOS.

## What Changes

- **A `Renderer` port.** Rendering moves out of `MediaTools`, which keeps `duration`, `extractAudio` and `copyAudio`. A draft job carries the caption groups, the caption style and the hook instead of an ASS path, so the ffmpeg provider calls `toAss` itself.
- **Motion and text timing in the domain.** `motionAt(motion, frame, frames)` gives a beat's zoom and position on each frame. `textAt(frame)` gives what text shows on each frame: which caption, how far its pop-in has got, and the hook. When `captions.highlight` is on, it also gives the words spoken so far, which take the highlight colour, as ASS's karaoke does today. Both functions work in whole frames (`round(t·30)`). `toAss` snaps its times to the same frames, so ASS and Takumi show each caption from the same frame; today ASS writes centiseconds and can be a frame later. An empty or blank hook counts as no hook.
- **Takumi draws the text; ffmpeg does the rest.** With `render.text: "takumi"`:
  - Takumi draws each distinct text state once, from a layout (see brand-look);
  - the frames go as raw pictures straight into the draft's own ffmpeg run, which still makes the beats, the motion and the audio, so the video is encoded once;
  - the blend runs in the video's own pixel format (`format=yuva420p`, `overlay=format=yuv420`), and only over the band of the frame where the layout can place text. With the default format the blend added 26–35 s;
  - the text layer has exactly as many frames as the draft. Captions that run past the end of the audio are cut;
  - a post with no captions and no hook (music with no words) starts no Takumi and blends nothing;
  - transcript words and the hook go in as text, never as markup, so `<`, `&` or quotes in a word can't break the page.
- **ASS stays the default** (`render.text: "ass"`) until Takumi passes the language tests below. Takumi is a young project, so it's pinned to one exact version. ASS can't draw colour emoji: in a test with ffmpeg-full 9.0.2, 🔥 came out as an empty box and ❤️ as a plain white shape. With `ass`, `draft check` (agent-previews) reports emoji in captions and the hook.
- **The outline is its own layer.** Takumi ignores `paint-order` and draws an outline over the letters, which thins them. The layout draws the outline underneath the letters instead.
- **Fonts are always files.** Takumi gets each font as bytes. No layout names a system font (see brand-look).
- **A stopped stream fails the render.** If Takumi stops before the last frame, ffmpeg ends the video (`eof_action=endall`), and the command fails instead of keeping a draft with captions missing at the end. Cancelling stops ffmpeg, as it does today.
- **The draft records how its text was drawn:** the text renderer, Takumi's version when Takumi drew it, and one hash of the look. That hash covers the layout, the look's values in `brand.json`, and the bytes of every font file the text could use, fallbacks included.
- **Changing the look doesn't undo approvals.** The draft's input hash has two parts:
  - the post's own inputs: audio, transcript and caption fixes, beats, images, clips, hook;
  - the look: the text renderer and its version, and the look hash.

  `draft render` renders again when either part changes. `capcut export` checks only the post's own inputs, so changing the brand's colours or upgrading Takumi doesn't block every approved draft.
- **The CapCut export keeps the styled text.** When Takumi drew the draft's text, the export also writes `capcut/text-overlay.mov` (ProRes 4444 with transparency), so the pop-ins and highlights can sit on their own track instead of being lost when captions come back from `captions.srt`. It draws the overlay only when the text renderer, its version and the look hash still match what the draft recorded. Otherwise it leaves the overlay out and says why, because a new overlay wouldn't match the approved draft.
- **Packaging:**
  - `@takumi-rs/core` at one exact version;
  - the Bun binaries load its native file through a direct `require` for each platform, because the package's own loader fails inside a compiled binary (about 8 MB more);
  - Nix uses the npm build as it is: it loads under Nix's Node with no `/lib`;
  - nothing to download at render time.
- **`doctor` always checks that Takumi loads.** Slides, covers and previews need it even when captions use ASS. It's a failure when `render.text` is `takumi`, and a warning otherwise. `draft render` with `takumi` on a machine without a Takumi build fails with `missing-tool`, and the fix says to set `render.text` to `ass`.

Not part of this change:
- HyperFrames and Remotion;
- new animations beyond today's pop-in, word highlight and hook slide-in;
- fonts and the list of layouts (brand-look);
- carousels and covers (their own changes);
- testing on Windows (Takumi ships a Windows build).
