# Changelog

Notable changes, newest first. The release workflow publishes each version's section as its release notes. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Install with `nix run github:guillempuche/shorts-studio` or native binaries (`install.sh`, `install.ps1`).
- `doctor` and `schema show`.
- Run one command on several posts with `--post a,b`, `--day` or `--in-stage`.
- Choose the transcription and image provider in config.json (`transcribe.provider`, `image.provider`). `doctor` checks only the keys of the providers in use.
- Any setting can come from a `SHORTS_*` environment variable, which wins over config.json and brand.json, such as `SHORTS_IMAGE_MODEL=flux-dev`.
- JSON Schemas for config.json and brand.json in `schemas/`, with a description for every setting, so editors complete and check them. `schema show --name config` prints one.
- Models are data: each provider ships its models with the price per unit and the day it was checked. `models` in config.json adds a model or changes a price, with no code. `models list` shows them all and the one each job uses.
- A monthly spending cap, `caps.monthlyUsd` ($100 by default), next to the daily and per-post caps. `budget show` reports the month.
- `doctor` warns when the price in use was checked more than 90 days ago, or when a model in config.json belongs to no provider in use, and fails when a job's model can't be used.
- CI builds the Linux, macOS and Windows binaries and runs them through `scripts/smoke-binary.ts`, and the release runs it before publishing, since the binaries run on Bun while the tests run on Node.

### Changed

- `script approve` covers the audio and every image prompt, not just the script: changing any of them needs approving again, and `next` says what changed. Posts approved before need approving again.
- `script approve` and `post review` run only from a terminal, so no agent can record your decision. The Claude Code and Codex rules also catch them with flags placed first.
- `audio transcribe` and `source transcribe` take `--dry-run` and show their cost. They still run without `--yes`, and the agent settings ask before them.
- Every paid call is priced by its units (megapixels or images, minutes of audio) times its model's price, and each ledger line records both, so a later price change doesn't move past totals. Transcription counts toward the caps.
- Days and months follow the machine's time zone, not UTC, for the caps, new post dates and `--day today`. `TZ` sets another zone, in any of its forms; one that names no zone falls back to UTC, and `doctor` warns.
- A spending reservation is freed only when nothing was billed: a refusal (HTTP 4xx), a job the provider reported failed, or a call stopped before sending. After a 5xx or a dropped connection it stays counted.
- When a call would pass several caps, the error names the per-post cap first, then the month's, then the day's, and says to wait only where waiting helps.
- `transcribe.model` names a model from `models list`. Another Together model needs an entry under `models` first.
- A ledger line whose time isn't written as commands write it, or whose amount is negative, makes the ledger read fail, naming the line.
- Beats: a silence before the first word, inside a short phrase or before the last word gets beats of its own. Plans made before are stale.
- Captions: a lone word joins its neighbour only within 4 words and never across a pause.
- The code is a workspace: `apps/cli`, `apps/mcp`, and packages for the domain, the use cases and the providers, built with Turbo and kept in step by syncpack.
- Node 26 runs the TypeScript directly; there is no build step.
- `transcript.json`, lock files and ledger lines are read through their Schemas, so a damaged file names the bad field and the fix.
- API keys are held as redacted values, so a key printed by mistake shows `<redacted>`.

### Fixed

- A `SHORTS_*` variable whose name starts like another setting's, such as `SHORTS_CAPTIONS_FONT_SIZE`, no longer makes config.json unreadable, which had put the spending caps back to their defaults. A variable with a value that isn't valid is reported by `doctor` and left out; config.json and the other variables still apply, and valid variables apply even when config.json isn't valid. A number or yes/no written as text in config.json (`"dailyUsd": "1"`) is still read as that value. A `SHORTS_MODELS_*` variable no longer replaces config.json's models.
- With `--json` (or `--json=true`), a command called wrong, or a group of commands given no command such as `post`, prints one JSON error object instead of help, and a run on several posts where some failed ends with the error object too. `doctor --json` names itself `doctor`.
- A file that can't be read or written (a folder in its place, no permission, a full disk) fails with a fix, instead of a stack trace and, with `--json`, no JSON at all. An unexpected failure ends the same way, with its trace on stderr. An image that was paid for but couldn't be saved is fetched again, free, on the next run.
- A lock file that can't be read no longer makes a command hang, Ctrl-C ends a wait for a busy post at once, and a lock left from before the machine restarted is taken over.
- A post folder copied under a new name is refused, instead of writing over the original's post.json. `post list` and `--day`/`--in-stage` name it by its folder.
- An HTTP 4xx while FAL finishes an image no longer counts as a refusal, since FAL had already taken the job on. Each check on an image gives up after 30 s, and its download after 2 minutes, instead of hanging, and the FAL key is sent only to FAL.

### Removed

- `source adopt`.
- The npm package: Node doesn't run TypeScript from inside `node_modules`.

### Fixed

- A total that lands exactly on a cap is no longer refused because of floating-point sums: the 50th $0.04 image under the $2 post cap goes through.
- A paid image or transcript is kept even when its ledger line can't be written.
- A ledger whose last line lost its newline, or that starts with a byte-order mark, stays readable.
- Negative caps, and calls priced below zero, are refused.
- `source transcribe` refuses a language code that isn't two letters, before sending the audio.
- `image generate --reroll` keeps the seeds when it stops on a missing key.
- Interrupting `image generate` while a request is being sent saves the request, so the next run resumes it instead of paying again.
- `capcut export` refuses a draft whose beats, images or captions changed after it was approved.
- A model's `options` in config.json can't change the image size, count, seed or prompt FAL is asked for, so the reservation always matches the bill.
- When you interrupt a command, it waits for ffmpeg to stop. No render keeps running and no temporary file is left.
- A command that spends nothing now refuses `--dry-run` instead of running for real.
- A config.json or brand.json that doesn't parse no longer stops every command. `doctor` reports it.
- `image generate` never sends a beat without a prompt, even on a reroll.
- When FAL ends a request, `image generate` frees its spending reservation and leaves no stale request behind.
- A missing transcript.json is transcribed again.
- Each `source download --url` gets its own folder.
- A failed import leaves no temporary file.
- A batch prints how many posts failed.
- Commands on a post that doesn't exist fail before taking its lock.
- With `--json`, a spending command run without `--yes` printed two objects. It now prints one, holding both the estimate and the error.
- Image estimates were about 24% low. FAL bills each image by whole megapixels, so a 1344×2400 image costs 4 MP: $0.012 with flux-schnell, $0.10 with flux-dev.

## [0.1.0] - 2026-11-06

### Added

- From audio to a draft you can review: import, word-timed transcription, beats, one AI image per beat, and an FFmpeg render with captions. Works on the CLI and as an MCP server.
- Story direction: each beat has a story moment that sets its length, motion and captions. An optional hook title.
- Review and hand-off: the evening review, a frame-exact CapCut export, finalize, publish and archive.
- Download and transcribe saved collections.
- Image import.
- Spending caps and `budget show`.
