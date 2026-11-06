# Changelog

Notable changes, newest first. The release workflow publishes each version's section as its release notes. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Install with `nix run github:guillempuche/shorts-studio`, native binaries (`install.sh`, `install.ps1`), or the npm package.
- `doctor`, `schema show`, and batching with `--post a,b`, `--day` and `--in-stage`.

### Fixed

- Interrupting a command waits for ffmpeg to stop, so no render keeps running and no temporary file is left.
- `--dry-run` on a command that spends nothing is refused instead of running it for real.
- A config.json or brand.json that doesn't parse no longer stops every command; `doctor` reports it.
- `image generate` never sends a beat without a prompt, even rerolled, and frees a reservation FAL ended without leaving a stale request behind.
- A missing transcript.json is transcribed again; each `source download --url` gets its own folder; a failed import leaves no temporary file; a batch prints how many posts failed; commands on a post that doesn't exist fail before taking its lock.

## [0.1.0] - 2026-11-06

### Added

- From audio to a reviewable draft: import, word-timed transcription, beats, one AI image per beat, and an FFmpeg render with captions, on the CLI and as an MCP server.
- Story direction: beats carry a story moment that sets their length, motion and captions; an optional hook title.
- Review and hand-off: the evening review, a frame-exact CapCut export, finalize, publish and archive; saved-collection downloads and transcription; image import; spend caps and `budget show`.
