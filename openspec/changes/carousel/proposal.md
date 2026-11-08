# Carousels

## Why

Carousels are the other daily format: 5–10 pictures that people swipe through, each with a line or two of text over an image. A carousel tells its post's story with the post's own images. The agent writes and checks it, and the user, who guides the story, reviews it like a draft.

## What Changes

- **The agent writes the slides.** `carousel set --post <slug> --from slides.json` saves 5–10 slides. Each slide has:
  - a role: `hook`, `point`, `proof` or `cta`. The first slide is the hook and the last the call to action;
  - a title and an optional body;
  - a layout;
  - its image, recorded by the image file's hash;
  - where to centre the crop.

  `slide set --slide N` (agent-previews) changes one slide under the same rules.
- **Where images come from:**
  - a beat's image or an imported image;
  - a frame of a beat's clip (video-beats), at the beat's middle unless a time is given;
  - the same image can serve several slides;
  - a `text-only` slide needs none.

  A post with no audio and no beats (a carousel-only post) uses imported images. If an image file changes or disappears, its slides need rendering again. For example, `beat plan --by-moment --force` drops beat images, and `image generate` reuses the file names.
- **Limits in the domain**, like caption limits. A title holds at most 8 words and 60 characters; a body at most 25 words and 180 characters. The character limits matter for languages written without spaces, such as Japanese and Chinese, where counting words doesn't work. These are starting values, to tune from use. They're checked before anything is drawn.
- **`carousel check --platform <p>`** runs the limits, then draws and measures every slide at that platform's size. It returns every problem at once, as data:
  - text that doesn't fit, with how many pixels it's over;
  - an image smaller than the slide;
  - a missing image.

  The crop centre is kept inside the image, so a crop never shows past its edge. It works over MCP too, so the agent can fix and check again.
- **`carousel render --platform instagram|tiktok`** draws PNG slides with Takumi (see renderer-text-layers), from a layout in the brand's look (see brand-look):
  - sizes: TikTok photo mode 9:16 (1080×1920). Instagram needs `--aspect 4:5` (1080×1350) or `--aspect 3:4` (1080×1440), each with safe margins;
  - it writes `carousel/<platform>/slide-01.png` and onwards, the clean crops without text, and `slides.md` with the text, so a typo can be fixed in the app;
  - it draws into a temporary folder and swaps it in whole, so going from 10 slides to 6 never leaves old slides behind;
  - fonts and emoji come from files, so it works offline.

  Takumi measured the same overflow as Chrome (513 px on a too-long slide) and drew 10 slides in about 0.6 s, against 2.4–3 s for Chrome.
- **The user reviews, like a draft.** `carousel review --platform <p> --decision approve|fix|reject` takes notes per slide (`--slide-notes "3:too long"`) and any slide notes waiting from the review page. It needs rendered slides for that platform. It records the hash of each PNG the user saw, so an approval is of those exact pictures. Like `post review`, it runs only in a terminal, so no agent can decide.
- **Its own status, per platform.** A post's video stage stays as it is. Each platform's carousel gets a status worked out from `post.json`:
  - `written`: the slides are set;
  - `rendered`: the PNGs match the slides' text, images, crops, layouts and size;
  - `needs-fix` or `rejected`: the user's decision;
  - `approved`: the user approved those PNGs.

  Changing a slide's text, image, crop or layout undoes the approval. Changing the brand's look doesn't: approved PNGs stay approved, and the next render uses the new look and needs a new review. `post show` names each platform's next step.

Not part of this change:
- new images made only for slides (slides use the post's images or imported ones);
- video carousel slides;
- scheduling and publishing;
- getting the slides onto a phone.
