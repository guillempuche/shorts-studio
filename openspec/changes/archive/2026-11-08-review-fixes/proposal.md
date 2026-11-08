# Review fixes

## Why

A review of everything built so far found seven ways the tool can spend money the user didn't approve, export something other than what they approved, or time beats and captions badly. Each one was confirmed with a failing test before it was fixed.

## What Changes

- **Approval covers what images are made from.** `script approve` records the script, the audio and every beat's image prompt. `image generate` refuses while any of them differs from what was approved, and `next` says which one changed. Posts approved before this change need approving again.
- **Approving needs a person at a terminal.** `script approve` and `post review` refuse to run when stdin isn't an interactive terminal, so no agent can run them, whatever order its flags are in. The Claude Code and Codex rules also cover the flag-first forms and `post review`.
- **Transcription takes a dry run.** `audio transcribe` and `source transcribe` spend money, so they accept `--dry-run` (and `dryRun` over MCP) and show their estimate. They still don't need `--yes`, as models-and-prices decided. The agent settings ask before both tools.
- **An interrupt can't split sending a request from saving it.** Sending an image request and saving its id in `post.json` finish together, so stopping a run mid-send can't make the next run pay for the same image again.
- **The CapCut export matches the approved draft.** `capcut export` refuses when the beats, images or captions changed after the draft was rendered, and names `draft render`.
- **A model's fields can't change what a call is billed for.** The image size, image count, seed and prompt are always the ones the estimate used, whatever `options` a model in `config.json` sets.
- **Silences get beats of their own, and captions don't span them.** Silence before the first word, inside or after a short phrase, or before the last word is cut into beats of normal length. A lone word joins a neighbouring caption only within the 4-word limit and never across a pause.

Not part of this change: the other review findings (post lifecycle gates, stale transcripts and beats after new audio, FAL timeouts and URL checks, CLI JSON output on usage errors).
