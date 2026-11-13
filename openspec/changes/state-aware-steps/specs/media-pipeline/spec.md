## MODIFIED Requirements

### Requirement: Beats SHALL cover the whole audio and cut between phrases

`beat plan` SHALL cut speech into beats of about 1.5–3 s, at pauses or sentence ends. The beats SHALL run back to back from 0 to the end of the audio, never past it. A silence longer than a beat, before the first word, between words or before the last word, SHALL be cut into beats of its own, and the next beat SHALL start when speech starts again. Audio without words SHALL be cut into beats of equal length. Planning again over a plan that has prompts SHALL need `--force`.

#### Scenario: Steady speech

- **WHEN** beats are planned for steady speech
- **THEN** every beat but the last lasts 1.5 to about 3 seconds
- **AND** there are no gaps between beats

#### Scenario: Music before the first word

- **WHEN** the first word is spoken 10 seconds in
- **THEN** the first 10 seconds are cut into beats of about 1.5–3 s
- **AND** a beat starts when the first word does

#### Scenario: A short phrase before a long pause

- **WHEN** a one-word sentence is followed by 8 seconds of silence
- **THEN** no beat lasts longer than about 3 seconds
- **AND** a beat starts when speech starts again

#### Scenario: A word that ends after the audio

- **WHEN** the transcript's last word ends after the audio does
- **THEN** the last beat ends where the audio ends

### Requirement: The CapCut export SHALL rebuild the draft with the same timing

`capcut export` SHALL work only on a draft whose current review approves it, also after the final video, and that is up to date with the post's beats, images, captions and audio. It SHALL write one clip per beat, in order, each with its motion and exactly the frames that beat has in the draft. It SHALL also write the audio, `captions.srt`, a clean draft (without burned-in captions) and a README with the steps to follow in CapCut.

#### Scenario: Audio from someone else's reel

- **WHEN** the post's audio origin is `others`
- **THEN** no audio file is exported
- **AND** the clean draft has no audio track

#### Scenario: Frame counts

- **WHEN** the clips are placed back to back
- **THEN** they have as many frames as the draft

#### Scenario: A draft that isn't approved

- **WHEN** the CapCut export runs on a draft the user hasn't approved
- **THEN** nothing is exported
- **AND** it fails with code `needs-approval`

#### Scenario: Beats changed after approval

- **WHEN** a beat's story moment changes after the draft was approved
- **AND** the CapCut export runs
- **THEN** nothing is exported
- **AND** it fails with code `stale`
- **AND** the fix names `draft render`

#### Scenario: Exporting again after the final video

- **WHEN** `capcut export` runs on a post that has a final video and whose current review approves the draft
- **THEN** the clips are exported

## ADDED Requirements

### Requirement: Beats SHALL be cut from the current transcript

`beat plan` SHALL refuse with `stale` while the post's transcript wasn't made from its audio, naming `audio transcribe`. Beats cut from the current transcript, or from the audio for music, SHALL count as up to date, also after a re-cut by moment, so `beat plan` without `--force` keeps them. `beat plan --by-moment` SHALL refuse while the beats aren't up to date.

#### Scenario: New audio

- **WHEN** `beat plan` runs after new audio was imported and before it was transcribed
- **THEN** the beats are unchanged
- **AND** it fails with `stale`, and its fix names `audio transcribe`

#### Scenario: A plain plan after a re-cut

- **WHEN** `beat plan` runs without `--by-moment` on beats re-cut by moment from the current transcript
- **THEN** it reports the plan up to date
- **AND** every beat and prompt is kept

#### Scenario: A transcript made again with other words

- **WHEN** `beat plan` runs on beats with prompts, after the transcript was made again with other words
- **THEN** the beats are unchanged
- **AND** it fails with `stale`, saying the beats were cut from an earlier transcript and how many prompts planning again drops

### Requirement: A draft SHALL be rendered only from up-to-date parts

`draft render` SHALL refuse with `stale`, naming what's out of date and with the post's next step as its fix, while the transcript or the beats are out of date, or a beat's image doesn't match its prompt and seed or has a request in flight. It SHALL refuse with `not-found`, naming the beat, when an image's file is gone.

#### Scenario: A prompt changed after its image

- **WHEN** beat 1's prompt changed after its image was made and `draft render` runs
- **THEN** nothing is rendered
- **AND** it fails with `stale`, naming beat 1

#### Scenario: An image file that's gone

- **WHEN** beat 1's generated image file was deleted and `draft render` runs
- **THEN** nothing is rendered
- **AND** it fails with `not-found`, and its fix names `image generate --post <slug> --beat 1 --dry-run`

#### Scenario: A request in flight

- **WHEN** beat 0 has an image request that was sent and not yet saved, and `draft render` runs
- **THEN** nothing is rendered
- **AND** it fails with `stale`, and its fix names `image generate`, which picks the request up without paying again

### Requirement: Transcription without words SHALL point at music

When the transcription provider finds no words in the audio, the error's fix SHALL say to import the audio again with kind `music` if it has no speech.

#### Scenario: An instrumental track imported as speech

- **WHEN** `audio transcribe` runs on an instrumental track imported as speech
- **THEN** it fails
- **AND** its fix names `source import` with `--kind music`
