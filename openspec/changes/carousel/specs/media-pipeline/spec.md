## ADDED Requirements

### Requirement: Carousel slides SHALL match the platform

`carousel render` SHALL make slides the right size for the chosen platform: 1080×1350 or 1080×1440 for Instagram, 1080×1920 for TikTok. Text SHALL stay inside that size's safe margins.

#### Scenario: TikTok

- **WHEN** a carousel is rendered for TikTok
- **THEN** every slide is 1080×1920

### Requirement: Slide text SHALL stay within limits

A carousel SHALL have 5 to 10 slides, the first with the role `hook` and the last `cta`. Each title SHALL hold at most 8 words and each body at most 25. `carousel set` SHALL refuse slides that break these, naming each one.

#### Scenario: A long title

- **WHEN** slide 3's title has 12 words
- **THEN** `carousel set` exits 2
- **AND** the error names slide 3 and the limit

### Requirement: Carousel checks SHALL report every problem as data

`carousel check` SHALL draw and measure every slide, and SHALL report every slide whose text doesn't fit its box or the safe margins. Each problem SHALL name the slide, what is wrong and by how many pixels, in the command's JSON output.

#### Scenario: Two slides too long

- **WHEN** slides 2 and 5 have text taller than their boxes
- **THEN** `carousel check` reports both, with how many pixels each is over
- **AND** it exits 1

### Requirement: Rendered slides SHALL come with their parts

`carousel render` SHALL write the slides as PNG, the same crops without text, and `slides.md` with each slide's text, so the text can be fixed by hand without drawing again.

#### Scenario: A typo found after rendering

- **WHEN** the user spots a typo on slide 4
- **THEN** `slides.md` has slide 4's text to copy
- **AND** `carousel/<platform>/clean-04.png` has its picture without text
