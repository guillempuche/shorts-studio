# media-pipeline Specification

## Purpose

How audio becomes a draft ready for review. shorts-studio imports the audio and transcribes it with the time of each word. It splits the audio into beats and makes one image per beat. Then FFmpeg renders the draft with the captions burned in.

## Requirements

### Requirement: Imported audio SHALL be converted to one format

`source import` SHALL convert any audio or video file to `audio/audio.m4a`. It SHALL record the audio's duration and hash, its origin (`mine`, `others`, `ai`) and its kind (`speech`, `music`).

#### Scenario: A video file

- **WHEN** an MP4 is imported
- **THEN** only its audio track is kept, as AAC in `audio/audio.m4a`

### Requirement: Transcripts SHALL hold the time of each word

`audio transcribe` SHALL store every word with its start and end. It SHALL detect the language itself unless one is given. It SHALL skip the work when the transcript is up to date.

#### Scenario: Running it again

- **WHEN** it runs again with the same audio and language
- **THEN** nothing is sent to the provider

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

### Requirement: Drafts SHALL stay in sync with the audio

`draft render` SHALL make a 1080×1920, 30 fps MP4 as long as the audio. Each beat SHALL get round(end·30) − round(start·30) frames. Captions of a few words each SHALL be burned in near the bottom of the safe zone. The command SHALL also write `captions.srt`.

#### Scenario: Frame counts

- **WHEN** a beat starts or ends between two frames
- **THEN** the frames still add up to the audio's length

### Requirement: Beat lengths SHALL follow the story moment

`beat plan --by-moment` SHALL cut the audio again so that each moment's beats fit that moment's length range. It SHALL still cut between words and cover the whole audio. It SHALL keep each beat's moment and drop its prompt.

#### Scenario: A vulnerable stretch

- **WHEN** a stretch of speech is marked `vulnerable` and cut again
- **THEN** its beats last about 4–6 seconds where the words allow

### Requirement: Motion SHALL follow the story moment

Each beat SHALL move the way its moment calls for, or the way its override says. Motions SHALL come from a fixed list. A beat SHALL never move past the image's edges.

#### Scenario: A twist

- **WHEN** a beat's moment is `twist`
- **THEN** it zooms in fast, within about half a second
- **AND** then holds still

#### Scenario: No moment

- **WHEN** a beat has no moment
- **THEN** it moves in slowly, in the same direction as the beats next to it

### Requirement: Captions SHALL stay within reading limits and safe zones

Each caption SHALL show at most 4 words, about 42 characters and about 17 characters per second. It SHALL stay on screen for at least 0.8 s. A single word SHALL never stand alone, unless it ends the audio or joining it would pass these limits or a pause. A caption SHALL never span a pause. Captions SHALL stay clear of the bottom 672 px and the right-hand 140 px of a 1080×1920 frame.

#### Scenario: A lone last word

- **WHEN** grouping would leave one word on its own mid-sentence
- **THEN** it joins the caption before it

#### Scenario: A lone word after four words

- **WHEN** a lone word follows a caption that already has 4 words
- **THEN** it doesn't join that caption

#### Scenario: A lone word after a pause

- **WHEN** a lone word follows a sentence after 5 seconds of silence
- **THEN** it doesn't join the caption before the silence
- **AND** no caption stays on screen through the silence

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

### Requirement: Imported images SHALL be kept

When `image import` attaches an image to a beat, `image generate` SHALL keep that image, unless the beat is rerolled. `image import` SHALL refuse, with `conflict`, a beat whose paid request is saved but not fetched, and while `image generate` runs on the post. Its fix SHALL say how to fetch the paid image first, with the model that sent it, and SHALL say when that run also pays for a new image because the beat changed since its request.

#### Scenario: Generating the other beats

- **WHEN** beat 0 has an imported image and images are generated
- **THEN** only the other beats are sent to the provider

#### Scenario: Importing over a saved request

- **WHEN** beat 1 has a saved request
- **AND** `image import --beat 1` runs
- **THEN** it fails with `conflict`
- **AND** beat 1's saved request is still there
- **AND** the fix names `image generate --post <slug> --beat 1 --model <the model that sent it>`

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
