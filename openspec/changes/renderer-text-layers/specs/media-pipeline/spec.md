## ADDED Requirements

### Requirement: Every renderer SHALL move a beat the same way

The zoom and position of a beat at each frame SHALL come from one function in the domain. Every renderer SHALL use it, so changing renderer never changes how a beat moves.

#### Scenario: Two renderers

- **WHEN** a draft is rendered with `render.text` set to `ass` and again with `takumi`
- **THEN** each beat has the same zoom and position on every frame

### Requirement: Text SHALL be timed in whole frames

What text shows on a frame SHALL come from one function in the domain, working in whole frames. A caption SHALL show from frame round(start·30) up to, but not including, frame round(end·30). A lit word and the hook SHALL follow the same rule.

#### Scenario: A start that falls exactly on a frame

- **WHEN** a caption starts at 3.3 s and the one before it ends at 3.3 s
- **THEN** frame 98 shows the earlier caption and frame 99 the new one
- **AND** no frame shows both

### Requirement: Text layers SHALL go into the draft in one encode

With `render.text` set to `takumi`, Takumi SHALL draw the captions and hook, and ffmpeg SHALL blend them over the beats in the same run that makes the beats, motion and audio, so the video is encoded once. The command SHALL still write `captions.srt`.

#### Scenario: A draft with text layers

- **WHEN** `draft render` runs with `render.text` set to `takumi`
- **THEN** the draft is 1080×1920, 30 fps and as long as the audio
- **AND** `captions.srt` is written

### Requirement: A text layer that stops early SHALL fail the render

When Takumi stops before it has drawn the last frame, `draft render` SHALL fail with code `failed`, keep the previous draft, and leave no partial file.

#### Scenario: Takumi crashes halfway

- **WHEN** the text layer stops at frame 900 of 1986
- **THEN** `draft render` exits 1
- **AND** `draft.mp4` is the draft from before

### Requirement: The same input SHALL give the same draft

Rendering the same post twice with the same settings, layout and Takumi version SHALL give identical frames.

#### Scenario: Two renders

- **WHEN** a draft is rendered twice without changes, the second time with `--force`
- **THEN** both drafts decode to identical frames

### Requirement: The CapCut export SHALL keep styled text

When the draft's text was drawn by Takumi, `capcut export` SHALL also write `text-overlay.mov`: the captions and hook alone, with transparency, as long as the draft.

#### Scenario: Styled captions

- **WHEN** an approved draft rendered with `takumi` is exported
- **THEN** `capcut/text-overlay.mov` has as many frames as the draft
- **AND** everything but the text is transparent
