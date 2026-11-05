# Review and hand-off

## Why

Milestone 1 ends at a draft. The evening check, the move to CapCut and the posting that follows still happened outside the tool, and downloads still ran through the vault's `ig-saved.sh`.

## What Changes

- `post review` (CLI-only): approve, fix with per-beat notes, or reject; `--animate` marks beats for milestone 3. A review counts only for the draft it was made on.
- New stages: `needs-fix`, `rejected`, `approved`, `final`, `posted`, `archived`.
- `capcut export`: one clip per beat with its motion applied (frame-exact with the draft), the audio (left out when its origin is `others`, or with `--mute`), `captions.srt`, a clean draft and a README with the CapCut steps. Only approved drafts are exported.
- `post finalize`, `post publish`, `post archive` close the loop after CapCut; archived posts leave `post list`.
- `source download` (CLI-only, the user's own yt-dlp, cookies opt-in via config) for saved collections or one URL into a post; `source adopt` brings `ig-saved.sh` folders in; `source transcribe` transcribes a collection with word timings.
- `image import` puts a Midjourney or other image on a beat; `image generate` keeps it unless rerolled.
- `budget show`.

Out of scope, moved to [packaging-and-tooling](../../packaging-and-tooling/proposal.md): `doctor`, `schema`, batching flags, the npm package, contributor docs, Codex rules, link-check CI. Covers and post copy (hook, CTA, hashtags) move to the daily-loop change.
