## MODIFIED Requirements

### Requirement: The setup check SHALL fail with the fixes

`config check` and its alias `doctor` SHALL check ffmpeg (with libass), ffprobe, yt-dlp and the API keys. When `render.text` is `takumi`, it SHALL also check that Takumi loads. When something blocks the work, it SHALL fail with code `missing-tool` and name each blocking problem with its fix.

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

### Requirement: Providers SHALL be chosen in settings

Each job (transcribe, make an image, speak, make music, animate a clip, draw a draft's text) SHALL be done by the provider named in the settings. Adding a provider SHALL need no change to the use cases or the domain. A draft's text SHALL be drawn with ASS unless `render.text` says otherwise.

#### Scenario: Another image provider

- **WHEN** `config.json` sets `image.provider` to a provider a fork added
- **THEN** `image generate` uses it, with its own price estimate and spending reservation

#### Scenario: The default text renderer

- **WHEN** `render.text` isn't set
- **THEN** `draft render` burns in the captions with ASS
