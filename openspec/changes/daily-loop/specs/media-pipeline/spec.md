## ADDED Requirements

### Requirement: Covers SHALL keep the hook where each platform shows it

`cover render` SHALL draw a 1080×1920 cover with the hook over the chosen frame or image, using the brand's cover layout. For Instagram, the hook SHALL sit inside the centred 3:4 crop (1080×1440) that the profile grid shows.

#### Scenario: An Instagram cover

- **WHEN** a cover is rendered for Instagram
- **THEN** the cover is 1080×1920
- **AND** the hook's text lies inside the centred 1080×1440 area

### Requirement: A cover's picture SHALL have no other text

The picture under a cover's hook SHALL come from a beat's image (at its zoom for `--at`, as it is for `--beat`) or a beat's clip, never from `draft.mp4`, whose frames carry captions and the hook.

#### Scenario: A cover from 0:02

- **WHEN** `cover render --at 0:02` runs and the draft shows the hook and a caption at 0:02
- **THEN** the cover shows only its own hook over the picture

### Requirement: A cover SHALL know its hook

`cover render` SHALL take its text from the platform's copy hook, then the script's hook, then `--text`. With none of them it SHALL exit 2, naming all three.

#### Scenario: A music post with no hook

- **WHEN** a post has no copy hook and no script hook, and `--text` isn't given
- **THEN** `cover render` exits 2
- **AND** the fix names `post copy set`, `script set --hook` and `--text`
