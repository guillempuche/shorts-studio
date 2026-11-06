# Changelog

Notable changes, newest first. The release workflow publishes each version's section as its release notes. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Install with `nix run github:guillempuche/shorts-studio`, native binaries (`install.sh`, `install.ps1`), or the npm package.
- `doctor` and `schema show`.
- Run one command on several posts with `--post a,b`, `--day` or `--in-stage`.

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

## [0.1.0] - 2026-11-06

### Added

- From audio to a draft you can review: import, word-timed transcription, beats, one AI image per beat, and an FFmpeg render with captions. Works on the CLI and as an MCP server.
- Story direction: each beat has a story moment that sets its length, motion and captions. An optional hook title.
- Review and hand-off: the evening review, a frame-exact CapCut export, finalize, publish and archive.
- Download and transcribe saved collections.
- Image import.
- Spending caps and `budget show`.
