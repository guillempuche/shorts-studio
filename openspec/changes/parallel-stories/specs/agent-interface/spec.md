## ADDED Requirements

### Requirement: Heavy renders SHALL wait for a free slot

`draft render`, the CapCut export's clips and `carousel render` SHALL each take one of `render.slots` before they start, across every process on the machine. With no free slot, a command SHALL wait and log which posts and commands hold the slots. A slot held by a process that no longer runs SHALL be taken over.

#### Scenario: More renders than slots

- **WHEN** `render.slots` is 2 and three posts start `draft render` at once
- **THEN** two render
- **AND** the third waits, then renders when one finishes

#### Scenario: Ctrl-C while waiting

- **WHEN** the user presses Ctrl-C while a command waits for a slot
- **THEN** it exits 130 and holds no slot

### Requirement: Paid requests SHALL share a limit per provider

Requests in flight to one provider SHALL stay within that job's limit (for images, `image.parallel`, 3 by default), counted across every post and process on the machine, not per post.

#### Scenario: Five posts make images at once

- **WHEN** five posts run `image generate` at the same time
- **THEN** no more than 3 image requests are in flight at any moment

### Requirement: Batch commands SHALL run in parallel only when asked

A command run on several posts SHALL handle one post at a time unless `--parallel N` is given, and then at most N at once. It SHALL report each post's result in the order the posts were selected.

#### Scenario: Today's drafts in parallel

- **WHEN** `draft render --day today --parallel 3` runs on five posts
- **THEN** at most 3 posts render at once, within the render slots
- **AND** the results list the five posts in order
