# Review and hand-off

## Why

Milestone 1 ends at a draft. The evening check, the move to CapCut and the posting that follows still happen outside the tool, and downloads still run through the vault's `ig-saved.sh`.

## What Changes

- `post review` (CLI-only): approve, fix with per-beat notes, or reject; `--animate` marks beats for milestone 3.
- `capcut export`: one timed clip per beat with the zoom applied, the audio (muted export when the audio's origin is `others`), `captions.srt` and a clean draft.
- `post finalize`, `post publish`, `post archive` to close the loop after CapCut.
- `source download` (CLI-only, the user's own yt-dlp, cookies opt-in) and `source adopt` for `ig-saved.sh` folders; then retire the script.
- `image import`, `doctor`, `budget show`, `schema`, `post copy set`, `cover render`; `--day` and `--in-stage` batching; karaoke captions.
- An npm package with a build step so `npx -y shorts-studio mcp serve` works.

Out of scope: voice, music and AI video (milestone 3), carousels (milestone 4).
