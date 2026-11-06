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

`beat plan` SHALL cut speech into beats of about 1.5–3 s, at pauses or sentence ends. The beats SHALL run back to back from 0 to the end of the audio. Audio without words SHALL be cut into beats of equal length. Planning again over a plan that has prompts SHALL need `--force`.

#### Scenario: Steady speech

- **WHEN** beats are planned for steady speech
- **THEN** every beat but the last lasts 1.5 to about 3 seconds
- **AND** there are no gaps between beats

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

Each caption SHALL show at most 4 words, about 42 characters and about 17 characters per second. It SHALL stay on screen for at least 0.8 s. A single word SHALL never stand alone, unless it ends the audio. Captions SHALL stay clear of the bottom 672 px and the right-hand 140 px of a 1080×1920 frame.

#### Scenario: A lone last word

- **WHEN** grouping would leave one word on its own mid-sentence
- **THEN** it joins the caption before it

### Requirement: The CapCut export SHALL rebuild the draft with the same timing

`capcut export` SHALL work only on an approved draft. It SHALL write one clip per beat, in order, each with its motion and exactly the frames that beat has in the draft. It SHALL also write the audio, `captions.srt`, a clean draft (without burned-in captions) and a README with the steps to follow in CapCut.

#### Scenario: Audio from someone else's reel

- **WHEN** the post's audio origin is `others`
- **THEN** no audio file is exported
- **AND** the clean draft has no audio track

#### Scenario: Frame counts

- **WHEN** the clips are placed back to back
- **THEN** they have as many frames as the draft

### Requirement: Imported images SHALL be kept

When `image import` attaches an image to a beat, `image generate` SHALL keep that image, unless the beat is rerolled.

#### Scenario: Generating the other beats

- **WHEN** beat 0 has an imported image and images are generated
- **THEN** only the other beats are sent to the provider
