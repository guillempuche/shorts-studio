# post-manifest Specification

## Purpose

`post.json` is the one record of a post: what has been made, from what, and what the user decided. Only commands write it. The post's stage is worked out from it.

## Requirements

### Requirement: post.json SHALL be written only by commands, safely

A command SHALL change `post.json` only while it holds that post's lock, in the folder it read it from, and only while the file's `slug` names that folder. It SHALL read the file again first, add 1 to `revision`, write a temporary file and rename it over `post.json`. A lock whose process no longer runs, or taken before the machine last started, SHALL be taken over. Ctrl-C SHALL end a wait for a lock at once.

#### Scenario: Two commands on one post

- **WHEN** a command holds a post's lock and another command asks for it
- **THEN** the second command waits
- **AND** after the wait, it names the holder and the holder's command

#### Scenario: A lock left by a crash

- **WHEN** the lock file names a process that isn't running
- **THEN** the next command takes the lock

#### Scenario: A copied post folder

- **WHEN** a post's folder is copied under another name and a command changes the copy
- **THEN** it refuses, naming the `slug` to set
- **AND** the original's `post.json` is unchanged
- **AND** `post list` names the copy by its folder

#### Scenario: A lock that can't be read

- **WHEN** a folder sits where a post's lock file goes
- **THEN** the command fails at once with a fix naming the lock file

### Requirement: A hand-edited post.json SHALL be checked when read

Reading `post.json` SHALL check it against its Schema. It SHALL report every invalid field with its path. The fix SHALL say that commands write this file.

#### Scenario: Two wrong fields

- **WHEN** `slug` is a number and `revision` is a string
- **THEN** reading fails
- **AND** the error names both paths

### Requirement: Generated outputs SHALL record what they were made from

Each transcript, beat plan, image and draft SHALL store an `inputHash` of its inputs. These inputs include the hashes of the earlier outputs it was built from and the version of the code that made it. An output SHALL count as up to date only while that hash still matches.

#### Scenario: A changed prompt

- **WHEN** a beat's prompt changes after its image was made
- **THEN** the next `image generate` makes that beat's image again
- **AND** it skips the other beats

### Requirement: The stage SHALL be worked out, never stored

A post's stage SHALL be worked out from `post.json`. It is one of `idea`, `script-ready`, `script-approved`, `assets` or `draft`.

#### Scenario: An approved script that was edited

- **WHEN** the script changes after approval
- **THEN** the post is back at `script-ready`

### Requirement: Beats SHALL carry their story moment

Each beat MAY record a story moment (`hook`, `setup`, `tension`, `twist`, `vulnerable`, `payoff`, `cta`) and a motion override. Both SHALL be part of the draft's input hash, so changing either one makes the draft out of date.

#### Scenario: Setting a moment

- **WHEN** `beat set` gives beat 0 the moment `hook`
- **THEN** `post.json` records it
- **AND** the next `draft render` renders the draft again

### Requirement: A post SHALL record what happens after the draft

`post.json` SHALL record the review, the final video, each platform the post was published on (one record per platform) and when it was archived. The stage SHALL follow these: `needs-fix`, `rejected`, `approved`, `final`, `posted`, `archived`. Archived posts SHALL be listed only when someone asks for them by stage.

#### Scenario: Finalizing before approval

- **WHEN** a final video is recorded for a draft that isn't approved
- **THEN** the command refuses with `needs-approval`
