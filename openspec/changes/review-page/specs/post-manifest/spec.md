## ADDED Requirements

### Requirement: Review notes SHALL wait for the user's decision

Notes taken before a decision SHALL be kept in `post.json` as waiting notes, each with its time, frame, beat or slide, the draft's hash, and text. The matching review command SHALL move them into the review it records. Waiting notes SHALL never change the post's stage or a carousel's status.

#### Scenario: Notes, then a decision

- **WHEN** the user takes two notes on the current draft, then runs `post review --decision fix`
- **THEN** the review records both notes with their beats
- **AND** no notes on the draft are left waiting

### Requirement: A draft SHALL record its beat times

A draft SHALL record each beat's first and last frame as it was rendered, so notes and the review page map times to the beats that were on screen.

#### Scenario: Reading a draft's beats

- **WHEN** a draft is rendered from 23 beats
- **THEN** `post.json`'s draft lists 23 frame ranges that cover every frame of the draft
