## ADDED Requirements

### Requirement: Review notes SHALL wait for the user's decision

Notes taken before a decision SHALL be kept in `post.json` as waiting notes, each with its time, beat or slide, and text. `post review` SHALL move them into the review it records. Waiting notes SHALL never change the post's stage.

#### Scenario: Notes, then a decision

- **WHEN** the user takes two notes on the page, then runs `post review --decision fix`
- **THEN** the review records both notes with their beats
- **AND** no notes are left waiting
