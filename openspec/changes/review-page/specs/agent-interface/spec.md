## ADDED Requirements

### Requirement: The review page SHALL only show posts and take notes

`post watch` SHALL be CLI-only. It SHALL listen only on 127.0.0.1, require the token in its address, reject a `Host` other than its own, and serve only the selected posts' files. The page SHALL write nothing but review notes, and SHALL offer no way to approve, fix or reject.

#### Scenario: Another site tries to read it

- **WHEN** a request reaches the page with a different `Host` or without the token
- **THEN** it gets no post data

#### Scenario: Deciding

- **WHEN** the user is done watching
- **THEN** the page shows the `post review` command to run in the terminal

### Requirement: Notes SHALL be tied to a moment

A note taken at a time SHALL record that time and the beat shown at that frame, using the draft's rule: a beat covers frames round(start·30) up to, but not including, round(end·30). `post review --note-at "<m:ss> <text>"` SHALL record notes the same way.

#### Scenario: A note at a beat change

- **WHEN** a note is taken at frame 99 and beat 2 starts at 3.3 s
- **THEN** the note is recorded on beat 2

### Requirement: The review page SHALL update itself

When a post's draft, images, slides or check results change, the page SHALL show the new ones without being reloaded by hand. A new draft SHALL start at the moment the old one was paused on.

#### Scenario: The agent renders again

- **WHEN** the draft is rendered again while the page is open and paused at 0:12
- **THEN** the page shows the new draft, paused at 0:12
