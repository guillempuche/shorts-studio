# post-manifest Specification

## Purpose

`post.json`, the single source of truth for one post: what has been made, from what, and what the user decided. Commands write it; its stage is computed from it.

## Requirements

### Requirement: The manifest SHALL be written only through commands, safely

Commands SHALL change `post.json` under a per-post lock, re-reading it first and bumping `revision`, and SHALL write it through a temporary file and a rename. A lock held by a process that no longer exists SHALL be taken over.

#### Scenario: Two commands on one post

- **WHEN** a command holds a post's lock and another asks for it
- **THEN** the second waits, and after the wait names the holder and its command

#### Scenario: A lock left by a crash

- **WHEN** the lock file names a process that isn't running
- **THEN** the next command takes the lock

### Requirement: A hand-edited manifest SHALL be validated on read

Reading `post.json` SHALL decode it against its Schema and report every invalid field with its path, with a fix that says commands write this file.

#### Scenario: Two wrong fields

- **WHEN** `slug` is a number and `revision` a string
- **THEN** reading fails naming both paths

### Requirement: Generated outputs SHALL record what they were made from

Each transcript, beat plan, image and draft SHALL store an `inputHash` of its inputs, including upstream outputs' hashes and the producing code's version, and SHALL count as up to date only while that hash matches.

#### Scenario: A changed prompt

- **WHEN** a beat's prompt changes after its image was made
- **THEN** the next `image generate` makes that beat's image again and skips the others

### Requirement: The stage SHALL be computed, not stored

A post's stage SHALL be derived from the manifest: `idea`, `script-ready`, `script-approved`, `assets` or `draft`.

#### Scenario: An edited approved script

- **WHEN** the script changes after approval
- **THEN** the post is back at `script-ready`

### Requirement: Beats SHALL carry their story moment

Each beat MAY record a story moment (`hook`, `setup`, `tension`, `twist`, `vulnerable`, `payoff`, `cta`) and a motion override. Both SHALL be part of the draft's input hash, so changing them makes the draft stale.

#### Scenario: Setting a moment

- **WHEN** `beat set` gives beat 0 the moment `hook`
- **THEN** the manifest records it and the next `draft render` renders again

### Requirement: A post SHALL record its life after the draft

The manifest SHALL record the review, the final video, every platform it was published on (one record per platform) and when it was archived; the stage SHALL follow them: `needs-fix`, `rejected`, `approved`, `final`, `posted`, `archived`. Archived posts SHALL be listed only when asked for by stage.

#### Scenario: Finalizing before approval

- **WHEN** a final video is recorded for a draft that isn't approved
- **THEN** it is refused with `needs-confirmation`
