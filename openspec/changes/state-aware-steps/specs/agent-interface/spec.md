## MODIFIED Requirements

### Requirement: Every post SHALL name its next step

`post show` and every command that changes a post SHALL return `next`, the command that moves the post forward, and `nextSteps`: each step's MCP tool and arguments when it has one, its CLI command, and `by`, `agent` or `user`. A step that spends money SHALL first be its dry run, and that dry run's next step SHALL be the real run, or the user's call when the estimate doesn't fit. The steps SHALL redo what no longer matches the post's own inputs. An archived post SHALL have none.

#### Scenario: A post with audio but no transcript

- **WHEN** `post show` runs on it
- **THEN** `next` is `audio transcribe --post <slug> --dry-run`
- **AND** its first step is the tool `audio_transcribe` with `{ post: <slug>, dryRun: true }`, by `agent`

#### Scenario: A post ready for images

- **WHEN** `post show` runs on a post whose script is approved and whose beats have no images
- **THEN** `next` is `image generate --post <slug> --dry-run`
- **AND** its first step is the tool `image_generate` with `{ post: <slug>, dryRun: true }`

#### Scenario: After a dry run of images

- **WHEN** `image generate --dry-run` runs on that post
- **THEN** its first step is the tool `image_generate` with `{ post: <slug> }` and the CLI command with `--yes`

#### Scenario: After a dry run that won't fit

- **WHEN** `image generate --dry-run` estimates more than is left of today's cap
- **THEN** its first step is the user's, naming the cap, with no tool

#### Scenario: A step that's the user's

- **WHEN** `post show` runs on a post whose script waits for approval
- **THEN** its first step is `script approve --post <slug>`, by `user`, with no tool

#### Scenario: New audio after the beats

- **WHEN** `source import` brings new audio to a post that has a transcript and beats
- **THEN** its first step is the tool `audio_transcribe` with `{ post: <slug>, dryRun: true }`

#### Scenario: Beats cut from an earlier transcript

- **WHEN** the transcript was made again with other words after beats with prompts were planned
- **THEN** the first step is the tool `beat_plan` with `{ post: <slug>, force: true }`
- **AND** its note says how many prompts planning again drops

#### Scenario: A music post

- **WHEN** `post show` runs on a post whose audio is music and that has no beats
- **THEN** `next` is `beat plan --post <slug>`
- **AND** no step transcribes the audio

#### Scenario: Moments without prompts

- **WHEN** some beats have a story moment, none has a prompt, and the beats weren't re-cut by moment
- **THEN** the first step is the tool `beat_plan` with `{ post: <slug>, byMoment: true }`
- **AND** the step after it, marked `or`, is the tool `beat_set`

#### Scenario: A prompt changed after its image

- **WHEN** beat 1's prompt changed after its image was made, beat 0's image is up to date, and the user approved the script again
- **THEN** `next` is `image generate --post <slug> --beat 1 --dry-run`

#### Scenario: A request in flight

- **WHEN** beat 0 has an image request that was sent and not yet saved, and beat 1's image is up to date
- **THEN** the first step is the tool `image_generate` with `{ post: <slug>, beat: "0", dryRun: true }`

#### Scenario: An image file that's gone

- **WHEN** beat 1's generated image file was deleted, and beat 0's image is up to date
- **THEN** the first step is the tool `image_generate` with `{ post: <slug>, beat: "1", dryRun: true }`

#### Scenario: A draft out of date before its review

- **WHEN** a beat's moment changes after the draft was rendered and before the user reviewed it
- **THEN** the first step is the tool `draft_render`
- **AND** the user's review comes after it

#### Scenario: An approved draft whose beats changed

- **WHEN** a beat's motion changes after the user approved the draft
- **THEN** the first step is the tool `draft_render`, not `capcut_export`

#### Scenario: Fixes asked

- **WHEN** the user's review asks for fixes, with notes on beats 1 and 3
- **THEN** the first steps are the agent's, one per note, each naming its beat, its note and the tools that fix it
- **AND** `draft_render` comes after them

#### Scenario: A rejected draft

- **WHEN** the user's review rejects the draft
- **THEN** the step is the user's, asking whether to rework the post or archive it, with no tool

#### Scenario: After the CapCut export

- **WHEN** `capcut export` runs on an approved draft
- **THEN** its first step is the user's: polishing in CapCut desktop
- **AND** no step exports again

#### Scenario: A published post

- **WHEN** `post show` runs on a post that's published
- **THEN** its steps are `post_publish` for another platform, or `post_archive`
- **AND** no step from before the draft appears, even when an image no longer matches its prompt

#### Scenario: An archived post

- **WHEN** `post show` runs on an archived post
- **THEN** `nextSteps` is empty
- **AND** `next` says the post is archived

## ADDED Requirements

### Requirement: Steps after the draft SHALL go to who acts next

`capcut export`, `post finalize` and `post publish` SHALL refuse a draft whose current review doesn't approve it, by who acts next. While it waits for the user's review: `needs-approval`, naming `post review --decision <decision>`. When the user rejected it: `needs-approval`, asking them to rework or archive the post. When the user asked for fixes: `conflict`, naming each note and `draft render`.

#### Scenario: Exporting before the review

- **WHEN** `capcut export` runs on a draft the user hasn't reviewed
- **THEN** nothing is exported
- **AND** it fails with `needs-approval`, and its fix names `post review --post <slug> --decision <decision>`

#### Scenario: Exporting a draft that needs fixes

- **WHEN** `capcut export` runs on a draft whose review asks for fixes, with a note on beat 1
- **THEN** nothing is exported
- **AND** it fails with `conflict`, and its fix names beat 1's note and `draft render`

#### Scenario: Publishing a rejected draft

- **WHEN** `post publish` runs on a post whose draft the user rejected
- **THEN** no platform is recorded
- **AND** it fails with `needs-approval`, and its fix asks the user to rework or archive the post

### Requirement: `post show` SHALL show the user's review

The text output of `post show` SHALL print the current review: its decision, its note and each beat's note.

#### Scenario: A review with notes

- **WHEN** `post show` runs without `--json` on a post whose review asks for fixes, with "too dark" on beat 1
- **THEN** its output shows the decision `fix`
- **AND** it shows `beat 1: too dark`
