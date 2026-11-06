# Architecture

How shorts-studio is built, and why. [README.md](../README.md) says what it does. [openspec/specs](../openspec/specs) says how each part must behave. For commands and flags, see `shorts-studio --help` or MCP `tools/list`.

## System overview

```
                 ┌───────────── src/operations/ ─────────────┐
 shorts-studio ─▶│ one Operation per command:                 │◀─ mcp serve (stdio)
 (effect/cli)    │   params (p.*) → CLI flags + MCP Schema    │   (effect/ai McpServer)
                 │   run(input, Context, RunMode) → Effect    │
                 └──────┬──────────────┬──────────────┬───────┘
                        │              │              │
                 src/core/        src/work/       src/domain/
                 post store,      Together, FAL,   Post Schema,
                 ledger, locks,   ffmpeg, beats,   stage
                 context          captions
                        │              │
               SHORTS_DATA_DIR    SHORTS_POSTS_DIR/mine/<date-slug>/
               ledger.jsonl       post.json, audio/, images/, draft.mp4
               config.json, brand.json
```

### One operation for both the CLI and MCP

Every command is an `Operation` in `src/operations/`, listed in `src/operations/index.ts`. Its parameters are declared with `p.*` (`src/core/operation.ts`). That one declaration gives both the CLI flag (kebab-case) and the MCP tool field (camelCase). `src/app/cli.ts` turns the list into `noun verb` commands, and `src/app/mcp.ts` turns it into `noun_verb` tools. Operations whose `surface` is `cli-only`, such as approving a script, are not offered over MCP. A test lists the MCP tools through Effect's in-memory client and checks that they match the list.

### A Context object instead of services

Operations are plain functions of `(input, Context, RunMode)`. `Context` (`src/core/context.ts`) holds the folders, settings, `secret()`, `fetch`, `run` (to start other programs), `now` and `log`. Tests pass their own `Context`, with a temporary folder, a fake server for `fetch` and a fixed time.

## Data flow

### Import

`source import` uses ffmpeg to convert any audio or video to `audio/audio.m4a`. It records the duration, hash, origin (`mine`, `others`, `ai`) and kind (`speech`, `music`).

### Transcribe

`audio transcribe` uploads the audio to Together and asks for `verbose_json` with word timestamps. It writes `transcript.json` with every word's start and end.

### Beats and prompts

`beat plan` (`src/work/beats.ts`) groups words into phrases of 1.5–3 s. It cuts at pauses of at least 0.25 s or at sentence ends, and lays the beats back to back from 0 to the end of the audio. Long silences are split. Audio without words gets beats of equal length.

Next, the agent marks each beat's story moment with `beat set`. Then `beat plan --by-moment` cuts each stretch of one moment again, to fit that moment's length range. Last, the agent writes one image prompt per beat.

Moments, length ranges and motions are defined in `src/domain/direction.ts`. The research behind them is in [docs/research](research/README.md).

### Images

`image generate` (`src/operations/image.ts`) needs the approved script. It works on each beat whose image is missing or out of date. For each one, it:

1. reserves the estimated cost in the ledger;
2. sends the request to FAL's queue;
3. saves the request in `post.json`;
4. checks back until the image is ready;
5. downloads it;
6. settles the reservation.

It works on three beats at a time.

### Draft

`draft render` first writes `captions.ass` and `captions.srt` (`src/work/captions.ts`). Each caption is a group of words within reading limits. It also adds the optional hook title. Then it runs one ffmpeg command (`src/work/render.ts`) that:

- upscales each image and moves it for exactly its beat's frames, with the motion its moment calls for (or its override);
- joins the beats in order;
- burns in the captions with libass;
- adds the audio;
- encodes H.264 at 1080×1920 and 30 fps.

### After the draft

The user runs `post review` (CLI-only) to approve, ask for a fix (with notes per beat) or reject. The review stores the draft's hash, so a new render needs a new review.

`capcut export` (`src/operations/capcut.ts`) renders one clip per beat, with its motion and exactly its frames from the draft. It also writes the audio (left out when it's someone else's), `captions.srt` and a clean draft.

`post finalize`, `post publish` and `post archive` record what happens after CapCut.

### Saved collections

`source download --collection` runs the user's own yt-dlp on the URLs in `<posts>/saved/<name>/urls.txt`. It keeps a download archive and pauses between downloads. `source transcribe --collection` writes transcripts with word times next to the audio. Both replace the old `ig-saved.sh`, and `source adopt` brings in that script's folders.

## Data model

### post.json

The Schema lives in `src/domain/post.ts`. `pnpm schemas` writes it to `schemas/post.schema.json`, and `schema show` prints it along with each command's schemas.

Only `updatePost` (`src/core/post-store.ts`) writes the file. It takes the post's lock file, reads the file again, makes the change, replaces the file in one step, and adds 1 to `revision`. Long operations don't hold the lock the whole time. Instead, they save each finished piece with a short update.

Every generated output stores an `inputHash`. It covers the output's inputs, the hashes of the earlier outputs it was built from, and the version of the code that made it (`PLANNER_VERSION`, `RENDERER_VERSION`). An output is up to date only while that hash matches. So an edited prompt or a re-cut beat also makes everything built from it out of date.

`stageOf` works out the stage from `post.json`. The stage itself is never stored.

### Ledger

`<data>/ledger.jsonl` (`src/core/ledger.ts`) is only ever added to. Each paid call adds a `reserve` entry before it starts, then a `settle` or `release` entry. Reservations are checked against `caps.dailyUsd` and `caps.postUsd` under one lock that every process shares.

## Agent interface

Results go to stdout. Progress and log messages go to stderr. With `--json`, stdout holds exactly one object: `{ ok: true, outputVersion, command, result }` or `{ ok: false, outputVersion, command, error: { code, message, fix } }`. A failed MCP call returns the same error object with `isError: true`.

Spending commands need `--yes` on the CLI. Over MCP they take `dryRun` instead, and the client's approval prompt does the job of `--yes`.

### Exit codes

| Code | Meaning                              | Error codes                                                                           |
| ---- | ------------------------------------ | ------------------------------------------------------------------------------------- |
| 0    | Success, including `--dry-run`       |                                                                                       |
| 1    | Failed                               | `failed`, `not-found`, `conflict`, `stale`, `missing-tool`, `missing-key`, `provider` |
| 2    | Usage error                          | `usage`, and unknown flags or commands                                                |
| 3    | Needs `--yes` or the user's approval | `needs-confirmation`                                                                  |
| 4    | A spending cap would be passed       | `over-budget`                                                                         |
| 130  | Interrupted (Ctrl-C or `kill`)       |                                                                                       |

## Key decisions

**Why one list of operations for the CLI and MCP, not two codebases:** an agent and a person must see the same commands with the same parameters. Building both from one declaration keeps them from drifting apart, and the parity test proves it.

**Why Effect only at the edges, not Effect services everywhere:** following content-studio's `docs/effect.md`, Effect is used only where it prevents a problem. Here that means interruption (`NodeRuntime.runMain` turns Ctrl-C into cleanup steps and exit 130) and the CLI and MCP layers. Passing a `Context` object keeps operations plain and tests simple.

**Why `spawn` with `stopWhenAborted`, not Effect's process spawner:** on POSIX, Effect's spawner detaches the programs it starts. So an interrupted render could leave ffmpeg running (measured in content-studio).

**Why reserve before sending, not record after:** if five posts generate at once, each would pass a check made after the fact. Reserving under one lock makes the cap hold.

**Why save the provider's request before waiting, not retry the call:** sending a request again can bill twice. Checking on the saved request after a crash can't.

**Why images 25% larger than the frame:** otherwise motion (zooms up to 15%, pans and drifts) would show the image's edges or have to upscale it. Also, ffmpeg's `zoompan` jitters on frames it hasn't upscaled.

**Why motion by story moment, not the same zoom on every beat:** the same movement all the time gets tiring. Moving in, pulling back and holding still each do a different job in a story ([docs/research/motion.md](research/motion.md)).

**Why approve the script, not only the draft:** rejecting a script costs nothing. Rejecting a finished draft wastes every image in it.

**Why local FFmpeg, not a render API:** there are no per-minute fees, it works offline and behind a VPN, and the beat timing stays exact.
