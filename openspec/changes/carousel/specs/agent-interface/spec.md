## ADDED Requirements

### Requirement: Carousels SHALL be approved by the user

`carousel approve` SHALL be CLI-only, and SHALL refuse with code `needs-confirmation`, recording nothing, when stdin isn't an interactive terminal. It SHALL record the slides' text, images and layout. Any later change to them SHALL make the carousel need approving again.

#### Scenario: An agent tries to approve

- **WHEN** `carousel approve` runs with stdin that isn't a terminal
- **THEN** the carousel stays unapproved
- **AND** the command exits 3

#### Scenario: A slide changed after approval

- **WHEN** slide 2's title changes after the carousel was approved
- **THEN** the carousel's status is back to `written`
