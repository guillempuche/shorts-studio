# Tasks

## 1. Fonts

- [ ] 1.1 The data folder's `fonts/`; `font add --file` (refusing non-fonts and duplicates without `--replace`) and `font list`
- [ ] 1.2 `font add --google <family>`, CLI-only, each file written whole or not at all
- [ ] 1.3 Ship Inter and Noto Color Emoji; their licences in `NOTICE`; Inter as the default caption font
- [ ] 1.4 Takumi falls back through the brand's fonts, then the shipped ones; `doctor` warns about letters none can draw
- [ ] 1.5 ASS captions use the same files through ffmpeg's `fontsdir`; test whether libass still falls back to system fonts
- [ ] 1.6 Every drawing command fails with `missing-tool` when a named family has no file

## 2. Look

- [ ] 2.1 `look` in `brand.json` and `brand.schema.json`: fonts, colours, text size, corner radius
- [ ] 2.2 Read the old `captions.*` keys when `look` doesn't set them; `doctor` warns when both do
- [ ] 2.3 `doctor` checks that every font the look names has a file

## 3. Layouts

- [ ] 3.1 Layouts as templates that declare their text boxes
- [ ] 3.2 The starting set: `bold-outline`, `boxed`, `photo-bottom`, `photo-top`, `text-only`, `cover-hook`
- [ ] 3.3 Reference pictures for each layout, checked in tests
- [ ] 3.4 A fork's layouts in the data folder's `layouts/`, never with a shipped name; `layout check` with sample text in every size
