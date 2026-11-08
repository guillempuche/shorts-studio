## ADDED Requirements

### Requirement: The setup check SHALL warn when HDR clips can't be converted

`doctor` SHALL warn, without failing, when the ffmpeg in use has no `zscale` filter, saying that HDR clips can't be imported and how to get an ffmpeg that has it.

#### Scenario: Homebrew's default ffmpeg

- **WHEN** ffmpeg has no `zscale` filter
- **THEN** `doctor` still exits 0
- **AND** it warns that HDR clips can't be imported
