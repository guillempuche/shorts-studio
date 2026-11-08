# Tasks

## 1. Slides

- [ ] 1.1 Slide schema in the domain: role, title, body, layout, image by file hash, crop centre; 5–10 slides, hook first, call to action last
- [ ] 1.2 Word and character limits per slide in the domain, with tests in Catalan, English and Japanese
- [ ] 1.3 `carousel set --from slides.json`; the same rules for `slide set`
- [ ] 1.4 Images from beats, imports or a clip's frame; reuse across slides; none for `text-only`
- [ ] 1.5 Each platform's carousel status in `post.json`, and its next step in `post show`

## 2. Drawing and checking

- [ ] 2.1 Draw slides with Takumi from the brand's slide layouts
- [ ] 2.2 Sizes and safe margins per platform; `--aspect 4:5|3:4` required for Instagram; crop centre kept inside the image
- [ ] 2.3 `carousel check --platform`: limits, then draw and measure every slide; text overflow, small or missing images, all as data, over the CLI and MCP
- [ ] 2.4 `carousel render`: PNG slides, clean crops and `slides.md`, drawn into a temporary folder and swapped in whole

## 3. Review

- [ ] 3.1 `carousel review --platform --decision approve|fix|reject`, terminal only, with slide notes and the review page's waiting slide notes
- [ ] 3.2 It needs rendered slides and records each PNG's hash
- [ ] 3.3 Changing a slide's text, image, crop or layout undoes the approval; a look change doesn't
- [ ] 3.4 The make-shorts skill: write, check and fix, render, then stop for the user
