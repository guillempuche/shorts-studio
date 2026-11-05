# Architecture

How shorts-studio is built and why. What it does is in [README.md](../README.md); the behaviour each part must keep is in [openspec/specs](../openspec/specs); commands and flags come from `shorts-studio --help` or MCP `tools/list`.

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

### One operation, two surfaces

Every command is an `Operation` in `src/operations/`, registered in `src/operations/index.ts`. Its parameters are declared with `p.*` (`src/core/operation.ts`), which yields both the CLI flag (kebab-case) and the MCP tool field (camelCase) from one definition. `src/app/cli.ts` turns the registry into `noun verb` commands; `src/app/mcp.ts` turns it into `noun_verb` tools. Operations whose `surface` is `cli-only` (approving a script) stay off MCP. A test lists the MCP tools through Effect's in-memory client and checks they match the registry.

### Context instead of services

Operations are plain functions of `(input, Context, RunMode)`. `Context` (`src/core/context.ts`) carries the folders, settings, `secret()`, `fetch`, `run` (child processes), `now` and `log`. Tests build a different `Context`: a temporary folder, a fake `fetch` target, fixed time.

## Data flow

### Import

`source import` converts any audio or video to `audio/audio.m4a` with ffmpeg, records duration, hash, origin (`mine`, `others`, `ai`) and kind (`speech`, `music`).

### Transcribe

`audio transcribe` uploads the audio to Together (`verbose_json`, word timestamps) and writes `transcript.json` with every word's start and end.

### Beats and prompts

`beat plan` (`src/work/beats.ts`) groups words into phrases of 1.5–3 s, cutting at pauses of 0.25 s or sentence ends, and makes the beats contiguous from 0 to the end of the audio. Long silences are split; audio without words gets an even grid. The agent then marks each beat's story moment with `beat set`, and `beat plan --by-moment` re-cuts each stretch of one moment to that moment's length range, before the agent writes one image prompt per beat. Moments, ranges and motions are defined in `src/domain/direction.ts`; the evidence is in [docs/research](research/README.md).

### Images

`image generate` (`src/operations/image.ts`) needs the approved script. For each beat whose image is missing or stale it reserves the estimated cost in the ledger, submits to FAL's queue, saves the request in `post.json`, polls, downloads, and settles the reservation. Three beats run at a time.

### Draft

`draft render` writes `captions.ass` and `captions.srt` from word groups within reading limits (`src/work/captions.ts`), plus the optional hook title, then runs one ffmpeg command (`src/work/render.ts`): each image upscaled and moved for exactly its beat's frames with the motion its moment calls for (or its override), concatenated, captions burned with libass, audio mapped, H.264 at 1080×1920 and 30 fps.

## Data model

### post.json

Schema in `src/domain/post.ts`, published as `schemas/post.schema.json` (planned). Written only through `updatePost` (`src/core/post-store.ts`): per-post lock file, re-read, change, atomic write, `revision` + 1. Long operations record each finished piece with a short update instead of holding the lock.

Every generated output stores an `inputHash`: the hash of its inputs, the upstream outputs' hashes and the producing code's version (`PLANNER_VERSION`, `RENDERER_VERSION`). An output is up to date only while that hash matches, so an edited prompt or a re-cut beat cascades downstream. The stage is computed from the manifest by `stageOf`, never stored.

### Ledger

`<data>/ledger.jsonl`, append-only (`src/core/ledger.ts`): a `reserve` entry before each paid call, then `settle` or `release`. Reservations are checked against `caps.dailyUsd` and `caps.postUsd` under one lock shared by every process.

## Agent interface

Results go to stdout; progress and diagnostics to stderr. With `--json`, stdout carries exactly one object: `{ ok: true, outputVersion, command, result }` or `{ ok: false, outputVersion, command, error: { code, message, fix } }`. MCP failures return the same error object with `isError: true`. Spending commands need `--yes` on the CLI and take `dryRun` over MCP, where the client's approval prompt is the gate.

### Exit codes

| Code | Meaning                              | Error codes                                                                           |
| ---- | ------------------------------------ | ------------------------------------------------------------------------------------- |
| 0    | Success, including `--dry-run`       |                                                                                       |
| 1    | Failed                               | `failed`, `not-found`, `conflict`, `stale`, `missing-tool`, `missing-key`, `provider` |
| 2    | Usage error                          | `usage`, and unknown flags or commands                                                |
| 3    | Needs `--yes` or the user's approval | `needs-confirmation`                                                                  |
| 4    | A spending cap would be passed       | `over-budget`                                                                         |
| 130  | Interrupted (SIGINT/SIGTERM)         |                                                                                       |

## Key decisions

**Why a CLI and MCP from one registry over two codebases:** an agent and a person must see the same commands with the same parameters; generating both from one declaration is what keeps them from drifting, and the parity test proves it.

**Why Effect only at the seams over Effect services everywhere:** following content-studio's `docs/effect.md`, Effect earns its place where it rules something out: interruption (`NodeRuntime.runMain` turns Ctrl-C into finalisers and exit 130), and the CLI and MCP surfaces. Passing a `Context` object keeps operations plain and tests simple.

**Why `spawn` with `stopWhenAborted` over Effect's process spawner:** Effect's spawner detaches children on POSIX, so an interrupted render could leave ffmpeg running (measured in content-studio).

**Why reserve before submitting over recording after:** five posts generating at once would each pass a check made after the fact; reserving under one lock makes the cap hold.

**Why save the provider's request before polling over retrying the call:** a retried submit can bill twice; polling the saved request after a crash can't.

**Why images 25% larger than the frame:** motion (zooms up to 15%, pans and drifts) would otherwise show the image's edges or upscale it; ffmpeg's `zoompan` also jitters on frames it hasn't upscaled.

**Why motion by story moment over the same zoom on every beat:** constant movement wears out, and push-ins, pull-backs and holds each do a different job in a story ([docs/research/motion.md](research/motion.md)).

**Why the script approval gate over approving drafts only:** rejecting a script costs nothing; rejecting a finished draft wastes every image in it.

**Why local FFmpeg over a render API:** no per-minute fees, works offline and behind a VPN, and the beat timing stays exact.
