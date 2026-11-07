# Attempt history and the posts repository

## Why

Images, clips, voices and music get made many times before one is kept, often with different models for the same job. Today a new attempt overwrites the old file, and only the cost is logged, so there is no way to see what was tried, compare models side by side, go back to an earlier attempt, or learn which prompts and models work.

## What Changes

- Each post gets `history.jsonl`: one line per attempt, never edited. A line holds the beat or track, provider, model, prompt, seed, cost, file and, when given, the experiment's name. Your verdict is a later line about that attempt.
- Replaced files move to the post's `attempts/` folder. `post archive` deletes the attempts that weren't kept; the history stays, so any attempt can be made again.
- **Trying models side by side.** `image generate --beat 3 --model flux-schnell,flux-dev --try` makes one attempt per model from the same prompt, and leaves the current image as it is. Each attempt reserves its own cost.
- **Your verdicts.** `attempt pick` makes an attempt the current one and records it as kept. `attempt reject` records a rejection, with an optional reason. Both are CLI-only, like `post review`, because judging the result is yours.
- **Experiments.** `--experiment <name>` tags the attempts a command makes, so one comparison can span several posts.
- `post history` shows a post's attempts and verdicts. `attempt report --by model` shows, for each job and model, across posts or one experiment: how many attempts, how many were kept, and the cost per kept attempt.
- The data folder is meant to be a private git repository (`config.json`, `brand.json`, the ledger and each post's text files), with media ignored by git and backed up to object storage (for example Cloudflare R2) with rclone. Its `.gitattributes` merges `ledger.jsonl` and `history.jsonl` line by line (`merge=union`), so lines added on two machines don't conflict. `docs/getting-started.md` explains the setup.

Not part of this change: a database, syncing between machines while both are working, a backup command (rclone is run by hand for now), and judging attempts automatically.
