# Carousels

## Why

Carousels are the other daily format: 5–10 pictures that people swipe through, each with a line or two of text over an image. A carousel tells its post's story with the post's own images. The agent writes and checks it, and the user, who guides the story, approves it.

## What Changes

- **The agent writes the slides.** `carousel set --post <slug> --from slides.json` saves 5–10 slides. Each has a role (`hook`, `point`, `proof`, `cta`), a title, an optional body, the image it uses (a beat's image, or one imported for the slide) and where to centre the crop. The first slide is the hook and the last the call to action.
- **Limits in the domain**, like caption limits. A title holds at most 8 words and a body at most 25. These are starting values, to tune from use. They're checked before anything is drawn.
- **`carousel check`** runs the limits, then draws and measures every slide. It returns every problem at once, as data: the slide, what's wrong and by how much (`slide 5: text 513 px too tall`). It works over MCP too, so the agent can fix and check again.
- **`carousel render --platform instagram|tiktok`** draws PNG slides with Takumi (see renderer-text-layers), from a layout in the brand's look (see brand-look):
  - sizes: Instagram 4:5 (1080×1350) or 3:4 (1080×1440), TikTok photo mode 9:16 (1080×1920), each with safe margins;
  - it writes `carousel/<platform>/slide-01.png` and onwards, the clean crops without text, and `slides.md` with the text, so a typo can be fixed in the app;
  - fonts and emoji come from files, so it works offline.

  Takumi measured the same overflow as Chrome (513 px on a too-long slide) and drew 10 slides in about 0.6 s, against 2.4–3 s for Chrome.
- **The user approves.** `carousel approve` records the slides' text, images and layout. Like `script approve`, it runs only in a terminal, so no agent can approve. Changing a slide afterwards needs approving again.
- **Its own status.** A post's video stage stays as it is. The carousel gets its own status, worked out from `post.json`: `written`, `rendered` or `approved`. `post show` names the carousel's next step too.

Not part of this change:
- new images made only for slides (slides use the post's images);
- video carousels;
- scheduling and publishing;
- getting the slides onto a phone.
