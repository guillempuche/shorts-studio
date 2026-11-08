# Agent previews and fixes

## Why

An agent working on a post today can only render the whole draft (about 25 s) and read JSON. It can't see what it made, and to fix one word it changes inputs and renders everything again. A good feedback loop needs three things: a picture of exactly what's being judged in under a second, problems reported as data, and edits that touch only what the feedback names.

## What Changes

- **`preview`** draws one picture without rendering the draft:
  - `--at <time|frame>`: that frame of the video. The picture is the beat's image at its zoom and position (`motionAt`), or for a beat with a clip (video-beats) the clip's frame at that moment, taken by ffmpeg. The text (`textAt`) is drawn with the draft's own text renderer: Takumi for `takumi`, libass in a one-frame ffmpeg run for `ass`. So line breaks and outlines match the draft, and only scaling can differ, by a pixel. A time outside the audio is refused, naming the range;
  - `--slide N --platform <p>`: one carousel slide;
  - `--cover --platform <p>`: the cover;
  - `--sheet`: every beat (its middle frame, or its clip's frame there) or every slide in a grid, each labelled with its number and time. At most 24 cells per picture; more beats make more pictures.

  A beat with neither an image nor a clip shows as a grey cell marked "no image", not as an error, so the agent can preview halfway through. Pictures are 540 px wide by default and sheets at most 1568 px on their longest side, so they stay cheap for an agent to look at. `--full` gives full size. Each preview replaces the last one of its kind in the post's `previews/` folder, so the folder stays small without anything deleting it.
- **The agent sees the picture.** `preview` is an operation like any other, defined once. An operation whose output includes a picture is registered on the MCP server with `McpServer.addTool`, which can return the picture itself next to its path, because the toolkit path sends every result back as JSON text. `schema show` describes its output as it does any other. On the CLI it prints the path.
- **One shape for problems.** `draft check` (new), `carousel check` and `layout check` report problems as a list of `{where, what, amount, unit}`. Captions are named by their word range and start time, for example `{where: "words 41–44 (0:12.4)", what: "too many characters", amount: 6, unit: "characters"}`, because caption numbers move when a break moves. Words and beats are numbered from 0. `draft check` covers:
  - captions over their reading limits, after every fix and break is applied together;
  - text outside its layout box or the safe zones, measured;
  - beats with neither an image nor a clip;
  - a caption that runs across a beat change at under 0.3 s from it;
  - with `render.text` set to `ass`, emoji in captions or the hook, which ASS can't draw.
- **Small fixes:**
  - `caption fix --word N --text "Cristina"` fixes a word's spelling and keeps its timing. Empty text is refused; `caption fix --word N --drop` removes a filler word instead, and a caption left with no words is dropped;
  - `caption break --after-word N` moves where one caption ends and the next starts, within the reading limits;
  - `slide set --slide N` changes one slide's title, body, layout or crop centre, under the carousel's limits.

  Fixes are stored apart from the transcript, keyed to it. If the transcript changes, they're dropped, and `post show` says so instead of applying them to the wrong words. `captions.srt` includes them.

Not part of this change: judging pictures automatically (the agent judges), video previews (the draft is the video preview), and fixes to images (`image generate --reroll` already does that).
