## ADDED Requirements

### Requirement: Carousel slides SHALL match the platform

`carousel render` SHALL make slides the right size: 1080×1920 for TikTok, and for Instagram 1080×1350 or 1080×1440 as `--aspect` says. Instagram without `--aspect` SHALL be refused. Text SHALL stay inside that size's safe margins, and the crop SHALL stay inside its image.

#### Scenario: TikTok

- **WHEN** a carousel is rendered for TikTok
- **THEN** every slide is 1080×1920

#### Scenario: Instagram without a shape

- **WHEN** `carousel render --platform instagram` runs without `--aspect`
- **THEN** it exits 2
- **AND** the fix names `--aspect 4:5` and `--aspect 3:4`

### Requirement: Slide text SHALL stay within limits

A carousel SHALL have 5 to 10 slides, the first with the role `hook` and the last `cta`. Each title SHALL hold at most 8 words and 60 characters, and each body at most 25 words and 180 characters. `carousel set` and `slide set` SHALL refuse slides that break these, naming each one.

#### Scenario: A long title

- **WHEN** slide 3's title has 12 words
- **THEN** `carousel set` exits 2
- **AND** the error names slide 3 and the limit

#### Scenario: Japanese with no spaces

- **WHEN** slide 2's title is 70 Japanese characters with no spaces
- **THEN** `carousel set` refuses it for the character limit

### Requirement: Carousel checks SHALL report every problem as data

`carousel check --platform` SHALL draw and measure every slide at that platform's size. It SHALL report every slide whose text doesn't fit its box or the safe margins, whose image is smaller than the slide, or whose image file is missing. Each problem SHALL name the slide, what is wrong and by how much.

#### Scenario: Two slides too long

- **WHEN** slides 2 and 5 have text taller than their boxes
- **THEN** `carousel check` reports both, with how many pixels each is over
- **AND** it exits 1

### Requirement: Rendered slides SHALL come with their parts

`carousel render` SHALL write the slides as PNG, the same crops without text, and `slides.md` with each slide's text. It SHALL replace the platform's folder whole, so no slide from an earlier render is left.

#### Scenario: Fewer slides than before

- **WHEN** a carousel of 10 slides is cut to 6 and rendered again
- **THEN** `carousel/<platform>/` holds exactly 6 slides

### Requirement: Slides SHALL point at image files by hash

Each slide SHALL record the hash of its image file. When that file changes or disappears, the slide SHALL no longer count as rendered, and `carousel check` SHALL name it.

#### Scenario: Beats cut again

- **WHEN** `beat plan --by-moment --force` drops the image slide 4 used
- **THEN** `carousel check` reports slide 4's image as missing
