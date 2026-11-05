## ADDED Requirements

### Requirement: Beat lengths SHALL follow the story moment

`beat plan --by-moment` SHALL re-cut the audio so that the beats of each moment fall within that moment's length range, still cutting at word boundaries and covering the whole audio. It SHALL keep each beat's moment and drop its prompt.

#### Scenario: A vulnerable stretch

- **WHEN** a stretch of speech is marked `vulnerable` and re-cut
- **THEN** its beats last about 4–6 seconds where the words allow

### Requirement: Motion SHALL follow the story moment

Each beat SHALL move with the motion its moment calls for, or with its override, from a fixed vocabulary, and SHALL never move past the image's edges.

#### Scenario: A twist

- **WHEN** a beat's moment is `twist`
- **THEN** it punches in within about half a second and then holds

#### Scenario: No moment

- **WHEN** a beat has no moment
- **THEN** it pushes in slowly, in the same direction as its neighbours

### Requirement: Captions SHALL respect reading limits and safe zones

Captions SHALL show at most 4 words, about 42 characters and 17 characters per second, stay up at least 0.8 s, never leave a single word alone unless it ends the audio, and sit clear of the bottom 672 px and the right-hand 140 px of a 1080×1920 frame.

#### Scenario: A lone last word

- **WHEN** grouping would leave one word on its own mid-sentence
- **THEN** it joins the caption before it
