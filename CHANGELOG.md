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

### Changed

- The code is a workspace: `apps/cli`, `apps/mcp`, and packages for the domain, the use cases and the providers, built with Turbo and kept in step by syncpack.
- Node 26 runs the TypeScript directly; there is no build step.
- `transcript.json`, lock files and ledger lines are read through their Schemas, so a damaged file names the bad field and the fix.
- API keys are held as redacted values, so a key printed by mistake shows `<redacted>`.

### Removed

- `source adopt`.
- The npm package: Node doesn't run TypeScript from inside `node_modules`.

### Fixed

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
