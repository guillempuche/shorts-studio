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

Each transcript, beat plan, image and draft SHALL store an `inputHash` of its inputs. These inputs include the hashes of the earlier outputs it was built from and the version of the code that made it. The command that makes an output SHALL skip it only while that hash still matches and its file exists. A transcript SHALL also record its audio's hash, a beat plan the hash it was cut from before any re-cut, and a generated image its beat's prompt.

#### Scenario: A changed prompt

- **WHEN** a beat's prompt changes after its image was made
- **THEN** the next `image generate` makes that beat's image again
- **AND** it skips the other beats

#### Scenario: An image file that's gone

- **WHEN** beat 1's generated image file was deleted and `image generate` runs
- **THEN** beat 1's image is made again with its seed
- **AND** it skips the other beats

#### Scenario: What a transcript was made from

- **WHEN** `audio transcribe` writes a transcript
- **THEN** `post.json` records the hash of the audio it was made from

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

`post.json` SHALL record the review, the final video, each platform the post was published on (one per platform) and when it was archived. The stage SHALL follow these: `needs-fix`, `rejected`, `approved`, `final`, `posted`, `archived`. Archived posts SHALL be listed only when asked for by stage. A platform SHALL be recorded only for an approved draft, a final video or a post already published, and a final video only before the post is published. Archiving again SHALL keep the first time.

#### Scenario: Finalizing before approval

- **WHEN** a final video is recorded for a draft that isn't approved
- **THEN** the command refuses with `needs-approval`

#### Scenario: Publishing before approval

- **WHEN** `post publish` runs on a post whose draft waits for the user's review
- **THEN** no platform is recorded
- **AND** it fails with `needs-approval`

#### Scenario: Publishing an approved draft

- **WHEN** `post publish` runs on an approved draft that has no final video
- **THEN** the platform is recorded
- **AND** the post is at `posted`

#### Scenario: Finalizing a published post

- **WHEN** `post finalize` runs on a post published on instagram
- **THEN** the final video is unchanged
- **AND** it fails with `conflict`, naming instagram

#### Scenario: Archiving twice

- **WHEN** `post archive` runs on a post archived the day before
- **THEN** `archivedAt` keeps the day before
- **AND** the result returns that time, with empty `nextSteps`

### Requirement: Later steps SHALL check outputs against the post's own inputs

Next steps and the commands that use an output SHALL count it as out of date when the post's own inputs changed since it was made: the audio for a transcript, the transcript (or the audio, for music) for beats, and a beat's prompt or seed for its image. A new provider, model or brand style SHALL NOT make them redo paid work.

#### Scenario: A new image model

- **WHEN** `config.json` names another image model after a post's images were made
- **THEN** `post show` doesn't send the post to `image generate`
- **AND** `draft render` renders with the images the post has

#### Scenario: New audio

- **WHEN** new audio is imported into a post that has a transcript
- **THEN** the transcript counts as out of date

### Requirement: An archived post SHALL stay as it is

Every command that changes a post or spends on it SHALL refuse an archived post with `conflict`, before it reserves or writes anything. A CLI run that selects posts by `--day` or `--in-stage` SHALL leave archived posts out, unless it selects stage `archived`.

#### Scenario: Spending on an archived post

- **WHEN** `image generate --yes` runs on an archived post
- **THEN** nothing is reserved or sent
- **AND** `post.json` is unchanged
- **AND** it fails with `conflict`, saying the post is archived

#### Scenario: Today's posts with one archived

- **WHEN** `draft render --day today` runs and one of today's posts is archived
- **THEN** that post is left out
- **AND** the others are rendered

#### Scenario: Reading an archived post

- **WHEN** `post show` runs on an archived post
- **THEN** it shows the post
