## ADDED Requirements

### Requirement: Animation SHALL be limited to beats chosen in review

`clip animate` SHALL only animate beats the user marked in `post review`, and SHALL reserve, resume and settle like image generation.

#### Scenario: An unmarked beat

- **WHEN** `clip animate` is asked for a beat not marked in review
- **THEN** it refuses with code `needs-confirmation`
