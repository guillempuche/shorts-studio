## ADDED Requirements

### Requirement: Covers SHALL keep the hook where each platform shows it

`cover render` SHALL draw a 1080×1920 cover with the hook over the chosen frame or image, using the brand's cover layout. For Instagram, the hook SHALL sit inside the centred 3:4 crop (1080×1440) that the profile grid shows.

#### Scenario: An Instagram cover

- **WHEN** a cover is rendered for Instagram
- **THEN** the cover is 1080×1920
- **AND** the hook's text lies inside the centred 1080×1440 area
