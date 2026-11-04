## ADDED Requirements

### Requirement: Music SHALL get beats from its rhythm

For audio of kind `music`, `beat plan` SHALL place beats on detected onsets or beats when an onset detector is available, and on an even grid otherwise.

#### Scenario: No detector installed

- **WHEN** aubio isn't installed
- **THEN** the plan falls back to the even grid and says so
