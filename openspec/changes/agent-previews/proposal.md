# Agent previews and fixes

## Why

An agent working on a post today can only render the whole draft (about 25 s) and read JSON. It can't see what it made, and to fix one word it changes inputs and renders everything again. A good feedback loop needs three things: a picture of exactly what's being judged in under a second, problems reported as data, and edits that touch only what the feedback names.

## What Changes

- **`preview`** draws one picture without rendering the draft:
  - `--at <time|frame>`: that frame of the video, meaning the beat's image at its zoom and position (`motionAt`) with the text on it (`textAt`). It's drawn by Takumi from the same numbers ffmpeg uses, so it can differ from the draft by a pixel of scaling, not by timing or layout;
  - `--slide N --platform <p>`: one carousel slide;
  - `--cover --platform <p>`: the cover;
  - `--sheet`: one picture with every beat (its middle frame) or every slide in a grid, each labelled with its number and time.

  Pictures are 540 px wide by default and sheets at most 1568 px on their longest side, so they stay cheap for an agent to look at. `--full` gives full size. They go into the post's `previews/` folder, which `post archive` deletes.
- **The agent sees the picture.** Over MCP, `preview` returns the picture itself as well as its path. It's registered with `McpServer.addTool`, because the toolkit path sends every result back as JSON text. On the CLI it prints the path.
- **One shape for problems.** `draft check` (new), `carousel check` and `layout check` report problems as a list of `{where, what, amount, unit}`, for example `{where: "caption 12", what: "too many characters", amount: 6, unit: "characters"}`. `draft check` covers:
  - captions over their reading limits;
  - text outside the safe zones, measured;
  - beats without images;
  - a caption that runs across a beat change at under 0.3 s from it.
- **Small fixes:**
  - `caption fix --word N --text "Cristina"` fixes a word's spelling and keeps its timing;
  - `caption break --after-word N` moves where one caption ends and the next starts, within the reading limits;
  - `slide set --slide N` changes one slide's title, body, layout or crop centre.

  Fixes are stored apart from the transcript, keyed to it. If the transcript changes, they're dropped, and `post show` says so instead of applying them to the wrong words.

Not part of this change: judging pictures automatically (the agent judges), video previews (the draft is the video preview), and fixes to images (`image generate --reroll` already does that).
