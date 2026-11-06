# Attempt history and the posts repository

## Why

Images, clips, voices and music get made many times before one is kept. Today a new attempt overwrites the old file, and only the cost is logged, so there is no way to see what was tried, go back to an earlier attempt, or learn which prompts work.

## What Changes

- Each post gets `history.jsonl`: one line per attempt, never edited. A line holds the beat or track, provider, model, prompt, seed, cost, file and, later, your verdict.
- Replaced files move to the post's `attempts/` folder. `post archive` deletes the attempts that weren't kept; the history stays, so any attempt can be made again.
- `post history` shows a post's attempts.
- The data folder is meant to be a private git repository (`config.json`, `brand.json`, the ledger and each post's text files), with media ignored by git and backed up to object storage (for example Cloudflare R2) with rclone. `docs/getting-started.md` explains the setup.

Not part of this change: a database, syncing between machines while both are working, a backup command (rclone is run by hand for now).
