## MODIFIED Requirements

### Requirement: The setup check SHALL fail with the fixes

`config check` and its alias `doctor` SHALL check ffmpeg (with libass), ffprobe, yt-dlp and the API keys. It SHALL also check that Takumi loads: a failure when `render.text` is `takumi`, a warning otherwise, because slides, covers and previews need it. When something blocks the work, it SHALL fail with code `missing-tool` and name each blocking problem with its fix.

#### Scenario: No ffmpeg

- **WHEN** ffmpeg isn't installed
- **THEN** `doctor` exits 1
- **AND** its message names ffmpeg and how to install it

#### Scenario: A broken settings file

- **WHEN** config.json or brand.json isn't valid
- **THEN** every command still starts, using the defaults
- **AND** `doctor` fails, naming the file and the problem

#### Scenario: Takumi doesn't load

- **WHEN** `render.text` is `takumi` and Takumi has no build for this machine
- **THEN** `doctor` exits 1
- **AND** its fix says to set `render.text` to `ass`

#### Scenario: Takumi doesn't load, captions on ASS

- **WHEN** `render.text` is `ass` and Takumi has no build for this machine
- **THEN** `doctor` exits 0
- **AND** it warns that slides, covers and previews can't be drawn

### Requirement: Providers SHALL be chosen in settings

Each job (transcribe, make an image, speak, make music, animate a clip, draw a draft's text) SHALL be done by the provider named in the settings. Adding a provider SHALL need no change to the use cases or the domain. A draft's text SHALL be drawn with ASS unless `render.text` says otherwise.

#### Scenario: Another image provider

- **WHEN** `config.json` sets `image.provider` to a provider a fork added
- **THEN** `image generate` uses it, with its own price estimate and spending reservation

#### Scenario: The default text renderer

- **WHEN** `render.text` isn't set
- **THEN** `draft render` burns in the captions with ASS

## ADDED Requirements

### Requirement: Drawing with a missing Takumi SHALL fail with its fix

`draft render` with `render.text` set to `takumi`, and every other command that draws with Takumi (slides, covers, and previews of Takumi text), SHALL fail with code `missing-tool` when Takumi doesn't load, and say how to fix it.

#### Scenario: A machine without a Takumi build

- **WHEN** `draft render` runs with `takumi` and Takumi doesn't load
- **THEN** it exits 1 with code `missing-tool`
- **AND** the fix says to set `render.text` to `ass`
