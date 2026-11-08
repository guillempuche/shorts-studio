# Tasks

## 1. Fonts

- [ ] 1.1 The data folder's `fonts/`; `font add --file` and `font list`
- [ ] 1.2 `font add --google <family>`, CLI-only, saving every weight once
- [ ] 1.3 Ship Inter and Noto Color Emoji; their licences in `NOTICE`
- [ ] 1.4 Fallback through the brand's fonts, then the shipped ones; `doctor` warns about letters none can draw
- [ ] 1.5 ASS captions use the same files through ffmpeg's `fontsdir`

## 2. Look

- [ ] 2.1 `look` in `brand.json` and `brand.schema.json`: fonts, colours, text size, corner radius
- [ ] 2.2 Read the old `captions.*` keys from `config.json`; `doctor` says to move them
- [ ] 2.3 `doctor` checks that every font the look names is in `fonts/`

## 3. Layouts

- [ ] 3.1 Layouts as templates that declare their text boxes
- [ ] 3.2 The starting set: `bold-outline`, `boxed`, `photo-bottom`, `photo-top`, `text-only`, `cover-hook`
- [ ] 3.3 Reference pictures for each layout, checked in tests
- [ ] 3.4 A fork's layouts in the data folder's `layouts/`; `layout check` with sample text in every size
