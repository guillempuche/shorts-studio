# Brand look: fonts and layouts

## Why

Captions, carousel slides and covers should look like one brand, on every machine. Today `config.json` names the caption font (`captions.font`, "Arial" by default), and each machine draws whatever font it has under that name. HyperFrames even swaps Arial for Inter on purpose. A name isn't enough: the look needs the font files themselves.

Agents fill in text many times a day. If they also wrote the design, small CSS mistakes would slip through, because Takumi supports only part of CSS and ignores the rest without saying so. So the design comes from a short list of tested layouts, and the agent only picks one and fills it in.

## What Changes

- **Fonts are files** in the data folder's `fonts/`:
  - `font add --file <font>` copies a TTF, OTF or WOFF2 file in;
  - `font add --google <family>` downloads a family once from Google Fonts. It's CLI-only, like `source download`, because it's a download;
  - `font list` shows each family, its weights and where it came from;
  - drawing never downloads anything.
- **Shipped with shorts-studio:** one open default family (Inter, OFL) and Noto Color Emoji (OFL, 10.7 MB), so text and emoji work with no setup. `NOTICE` lists their licences.
- **Missing letters fall back.** When the brand's font lacks a letter (an accent, Arabic, Japanese), the text uses the next font in the brand's list, then the shipped ones. `doctor` warns when a post's text has letters none of them can draw.
- **The look lives in `brand.json`** under `look`:
  - fonts for titles, body text and captions, named by family from `fonts/`;
  - colours: text, accent, background, and the dark gradient behind text;
  - text size and corner radius.

  `config.json`'s `captions.font`, `fontsDir` and `fontSize` are still read, and `doctor` says to move them. The ASS captions use the same font files (through ffmpeg's `fontsdir`), so both text renderers show the same font.
- **Layouts from a fixed list**, like motions:
  - captions: `bold-outline`, `boxed`;
  - slides: `photo-bottom`, `photo-top`, `text-only`;
  - covers: `cover-hook`.

  Each is a template in the repository, drawn by Takumi and checked against reference pictures in tests. A carousel slide or a post names its layout; the agent never writes CSS. Each layout declares its text boxes, so the draft knows the band where text can appear and the fit check knows each box.
- **A fork's own layouts** go in the data folder's `layouts/`. `layout check` draws one with sample text in every size and runs the fit check, so a broken layout fails there and not in a daily post.
- **`doctor`** checks that every font `brand.json` names is in `fonts/`.

Not part of this change: a visual editor for layouts, variable-font settings, and more caption animations.
