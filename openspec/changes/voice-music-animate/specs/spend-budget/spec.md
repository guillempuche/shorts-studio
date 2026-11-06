## ADDED Requirements

### Requirement: Animation SHALL be limited to beats chosen in review

`clip animate` SHALL only animate beats the user marked in `post review`. It SHALL reserve, resume and settle its cost the same way image generation does.

#### Scenario: An unmarked beat

- **WHEN** `clip animate` is asked for a beat not marked in review
- **THEN** it refuses with code `needs-confirmation`
