## ADDED Requirements

### Requirement: The review page SHALL only show posts and take notes

`post watch` SHALL be CLI-only and SHALL refuse with code `needs-confirmation` when stdin isn't an interactive terminal. It SHALL listen only on 127.0.0.1, require the token in its address, reject a `Host` other than its own, and serve only the selected posts' files. The page SHALL write nothing but notes, and SHALL offer no way to approve, fix or reject.

#### Scenario: Another site tries to read it

- **WHEN** a request reaches the page with a different `Host` or without the token
- **THEN** it gets no post data

#### Scenario: An agent's shell

- **WHEN** `post watch` runs with stdin that isn't a terminal
- **THEN** it exits 3 and serves nothing

### Requirement: Notes SHALL be tied to the frame on screen

A note taken at a time t SHALL record the frame floor(t·30), the beat that frame belonged to in the beat times the draft was rendered with, and the draft's hash. `post review --note-at "<m:ss> <text>"` SHALL record notes the same way.

#### Scenario: Paused just before a beat change

- **WHEN** the video is paused at 3.32 s, which shows frame 99, and beat 2 starts at frame 99
- **THEN** the note is recorded on beat 2 at frame 99

#### Scenario: Beats cut again after the render

- **WHEN** a note is taken at 0:12 and the beats were cut again after the draft was rendered
- **THEN** the note names the beat that was on screen in that draft

### Requirement: The decision SHALL show the notes it takes in

`post review` SHALL print the waiting notes before recording, take in those taken on the current draft, and keep notes taken on an older draft marked as such. Notes on slides SHALL wait for `carousel review` instead.

#### Scenario: A note from an older draft

- **WHEN** a note was taken, the draft was rendered again, and then `post review --decision fix` runs
- **THEN** the output lists that note as being about an earlier draft
- **AND** the review keeps it marked with that draft's hash

### Requirement: The review page SHALL update itself

When a post's draft, images, slides or check results change, the page SHALL show the new ones without being reloaded by hand. A new draft SHALL start at the moment the old one was paused on.

#### Scenario: The agent renders again

- **WHEN** the draft is rendered again while the page is open and paused at 0:12
- **THEN** the page shows the new draft, paused at 0:12
