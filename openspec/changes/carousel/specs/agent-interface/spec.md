## ADDED Requirements

### Requirement: Carousels SHALL be reviewed by the user

`carousel review --platform <p> --decision approve|fix|reject` SHALL be CLI-only, and SHALL refuse with code `needs-confirmation`, recording nothing, when stdin isn't an interactive terminal. It SHALL need rendered slides for that platform, SHALL record each PNG's hash, and SHALL take in notes per slide and the slide notes waiting from the review page.

#### Scenario: An agent tries to approve

- **WHEN** `carousel review --decision approve` runs with stdin that isn't a terminal
- **THEN** the carousel stays unapproved
- **AND** the command exits 3

#### Scenario: Asking for fixes

- **WHEN** the user runs `carousel review --platform tiktok --decision fix --slide-notes "3:too long"`
- **THEN** the TikTok carousel's status is `needs-fix`
- **AND** `post show` gives the agent slide 3's note

#### Scenario: Nothing rendered yet

- **WHEN** `carousel review --platform tiktok` runs before any TikTok render
- **THEN** it exits 2 and names `carousel render --platform tiktok`
