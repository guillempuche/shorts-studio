## MODIFIED Requirements

### Requirement: Beats SHALL cover the whole audio and cut between phrases

`beat plan` SHALL cut speech into beats of about 1.5–3 s, at pauses or sentence ends. The beats SHALL run back to back from 0 to the end of the audio. A silence longer than a beat, before the first word, between words or before the last word, SHALL be cut into beats of its own, and the next beat SHALL start when speech starts again. Audio without words SHALL be cut into beats of equal length. Planning again over a plan that has prompts SHALL need `--force`.

#### Scenario: Steady speech

- **WHEN** beats are planned for steady speech
- **THEN** every beat but the last lasts 1.5 to about 3 seconds
- **AND** there are no gaps between beats

#### Scenario: Music before the first word

- **WHEN** the first word is spoken 10 seconds in
- **THEN** the first 10 seconds are cut into beats of about 1.5–3 s
- **AND** a beat starts when the first word does

#### Scenario: A short phrase before a long pause

- **WHEN** a one-word sentence is followed by 8 seconds of silence
- **THEN** no beat lasts longer than about 3 seconds
- **AND** a beat starts when speech starts again

### Requirement: Captions SHALL stay within reading limits and safe zones

Each caption SHALL show at most 4 words, about 42 characters and about 17 characters per second. It SHALL stay on screen for at least 0.8 s. A single word SHALL never stand alone, unless it ends the audio or joining it would pass these limits or a pause. A caption SHALL never span a pause. Captions SHALL stay clear of the bottom 672 px and the right-hand 140 px of a 1080×1920 frame.

#### Scenario: A lone last word

- **WHEN** grouping would leave one word on its own mid-sentence
- **THEN** it joins the caption before it

#### Scenario: A lone word after four words

- **WHEN** a lone word follows a caption that already has 4 words
- **THEN** it doesn't join that caption

#### Scenario: A lone word after a pause

- **WHEN** a lone word follows a sentence after 5 seconds of silence
- **THEN** it doesn't join the caption before the silence
- **AND** no caption stays on screen through the silence

### Requirement: The CapCut export SHALL rebuild the draft with the same timing

`capcut export` SHALL work only on an approved draft that is up to date with the post's beats, images, captions and audio. It SHALL write one clip per beat, in order, each with its motion and exactly the frames that beat has in the draft. It SHALL also write the audio, `captions.srt`, a clean draft (without burned-in captions) and a README with the steps to follow in CapCut.

#### Scenario: Audio from someone else's reel

- **WHEN** the post's audio origin is `others`
- **THEN** no audio file is exported
- **AND** the clean draft has no audio track

#### Scenario: Frame counts

- **WHEN** the clips are placed back to back
- **THEN** they have as many frames as the draft

#### Scenario: Beats changed after approval

- **WHEN** a beat's story moment changes after the draft was approved
- **AND** the CapCut export runs
- **THEN** nothing is exported
- **AND** the fix names `draft render`
