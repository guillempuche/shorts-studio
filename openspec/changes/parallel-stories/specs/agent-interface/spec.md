## ADDED Requirements

### Requirement: A post SHALL render once at a time

`draft render`, `capcut export` and `clip import` SHALL hold the post's lock from start to finish. A second run on the same post SHALL wait, and over MCP, after a set wait, SHALL return `conflict` naming the holder.

#### Scenario: An agent retries a render

- **WHEN** an MCP `draft_render` is still running and the same post's render is called again
- **THEN** the second call waits, and returns `conflict` naming the first if the wait runs out
- **AND** only one ffmpeg run writes the post's files

### Requirement: Heavy renders SHALL wait for a free slot

`draft render`, `capcut export` and `clip import` SHALL each hold one of `render.slots` for their whole run, across every process on the machine, and never more than one. With no free slot, a command SHALL wait and log who holds them. A slot whose process no longer runs on this host SHALL be taken over. Slots SHALL be kept per machine, outside the data folder.

#### Scenario: More renders than slots

- **WHEN** `render.slots` is 2 and three posts start `draft render` at once
- **THEN** two render
- **AND** the third waits, then renders when one finishes

#### Scenario: Ctrl-C while waiting

- **WHEN** the user presses Ctrl-C while a command waits for a slot
- **THEN** it exits 130 and holds no slot

#### Scenario: A data folder synced from another machine

- **WHEN** the data folder comes from another machine where a render was running
- **THEN** this machine's slots are all free

### Requirement: Paid requests SHALL share one limit per provider

Requests in flight to one provider SHALL stay within its `parallel` limit (3 by default), counted across every job, post and process on the machine. A request slot whose process no longer runs on this host SHALL be taken over.

#### Scenario: Images and clips from one provider

- **WHEN** one post makes images and another animates clips, both with FAL
- **THEN** no more than 3 FAL requests are in flight at any moment

### Requirement: Batch commands SHALL run in parallel only when asked

A command that never asks the user anything, run on several posts, SHALL handle one post at a time unless `--parallel N` is given, and then at most N at once. It SHALL report each post's result in the order the posts were selected, and start each log line with the post's slug. Ctrl-C SHALL stop every running post and report the finished ones.

#### Scenario: Today's drafts in parallel

- **WHEN** `draft render --day today --parallel 3` runs on five posts
- **THEN** at most 3 posts render at once, within the render slots
- **AND** the results list the five posts in order
