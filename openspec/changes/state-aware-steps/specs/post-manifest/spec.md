## MODIFIED Requirements

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

### Requirement: A post SHALL record what happens after the draft

`post.json` SHALL record the review, the final video, each platform the post was published on (one record per platform) and when it was archived. The stage SHALL follow these: `needs-fix`, `rejected`, `approved`, `final`, `posted`, `archived`. Archived posts SHALL be listed only when someone asks for them by stage. A platform SHALL be recorded only for an approved draft or a final video, and a final video only before the post is published. Archiving again SHALL keep the first time.

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

## ADDED Requirements

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
