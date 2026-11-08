## ADDED Requirements

### Requirement: Every renderer SHALL move a beat the same way

The zoom and position of a beat at each frame SHALL come from one function in the domain. Every renderer SHALL use it, so changing renderer never changes how a beat moves.

#### Scenario: Two renderers

- **WHEN** a draft is rendered with `render.text` set to `ass` and again with `takumi`
- **THEN** each beat has the same zoom and position on every frame

### Requirement: Text SHALL be timed in whole frames

What text shows on a frame SHALL come from one function in the domain, working in whole frames. A caption SHALL show from frame round(start·30) up to, but not including, frame round(end·30). The hook and highlighted words SHALL follow the same rule. ASS captions SHALL snap their times to these frames too.

#### Scenario: A start that falls exactly on a frame

- **WHEN** a caption starts at 3.3 s and the one before it ends at 3.3 s
- **THEN** frame 98 shows the earlier caption and frame 99 the new one
- **AND** no frame shows both

#### Scenario: A start between two frames, with ASS

- **WHEN** a caption starts at 3.316 s and `render.text` is `ass`
- **THEN** the caption first shows on frame 99, as it does with `takumi`

### Requirement: Highlighted words SHALL be the words spoken so far

When `captions.highlight` is on, every word of the caption on screen whose start frame has been reached SHALL take the highlight colour, with both renderers. When it is off, no word SHALL be highlighted.

#### Scenario: Highlight off

- **WHEN** `captions.highlight` isn't set
- **THEN** every caption's words keep one colour

### Requirement: Text layers SHALL go into the draft in one encode

With `render.text` set to `takumi`, Takumi SHALL draw the captions and hook, and ffmpeg SHALL blend them over the beats in the same run that makes the beats, motion and audio. The text layer SHALL have exactly the draft's frame count. A post with no captions and no hook SHALL start no Takumi. The command SHALL still write `captions.srt`.

#### Scenario: A draft with text layers

- **WHEN** `draft render` runs with `render.text` set to `takumi`
- **THEN** the draft is 1080×1920, 30 fps and as long as the audio
- **AND** `captions.srt` is written

#### Scenario: Music with no words or hook

- **WHEN** a music post has no transcript words and no hook
- **THEN** the draft is rendered without starting Takumi

### Requirement: Caption and hook text SHALL never be read as markup

Transcript words, caption fixes and the hook SHALL reach Takumi as text. Characters such as `<`, `&` and quotes SHALL show as themselves.

#### Scenario: A word with an ampersand

- **WHEN** a transcript word is `R&D` and `render.text` is `takumi`
- **THEN** the caption shows `R&D`

### Requirement: A text layer that stops early SHALL fail the render

When Takumi stops before it has drawn the last frame, `draft render` SHALL fail with code `failed`, keep the previous draft, and leave no partial file.

#### Scenario: Takumi crashes halfway

- **WHEN** the text layer stops at frame 900 of 1986
- **THEN** `draft render` exits 1
- **AND** `draft.mp4` is the draft from before

### Requirement: The same input SHALL give the same draft

Rendering the same post twice with the same settings, look, font files and Takumi version SHALL give identical frames.

#### Scenario: Two renders

- **WHEN** a draft is rendered twice without changes, the second time with `--force`
- **THEN** both drafts decode to identical frames

### Requirement: A look change SHALL NOT block exporting an approved draft

The draft SHALL record its text renderer, Takumi's version when it was used, and one hash of the look: layout, look values and the bytes of every font file the text could use. `capcut export` SHALL check only the post's own inputs (audio, transcript and fixes, beats, images, clips, hook), not the look.

#### Scenario: New brand colours after approval

- **WHEN** the brand's accent colour changes after a draft was approved
- **THEN** `capcut export` still exports that draft
- **AND** the next `draft render` renders with the new colour

### Requirement: The CapCut export SHALL keep styled text only when it matches

When Takumi drew the draft's text, `capcut export` SHALL also write `text-overlay.mov`: the captions and hook alone, with transparency, as long as the draft. It SHALL do so only while the renderer, version and look hash match what the draft recorded. Otherwise it SHALL leave the overlay out and say why.

#### Scenario: Styled captions

- **WHEN** an approved draft rendered with `takumi` is exported, with the same look
- **THEN** `capcut/text-overlay.mov` has as many frames as the draft
- **AND** everything but the text is transparent

#### Scenario: A font file replaced after approval

- **WHEN** the caption font file was replaced after the draft was rendered
- **THEN** the export has no `text-overlay.mov`
- **AND** its output says the look changed since the draft
