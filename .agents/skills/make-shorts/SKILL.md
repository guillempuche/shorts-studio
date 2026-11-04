---

name: make-shorts
description: Run the daily short-video loop with shorts-studio - from audio or a brief to a reviewable draft per post, with the user approving each script before anything is spent. Use when asked to make, continue or batch short videos, reels or TikToks, or to prepare today's posts.
compatibility: Claude Code, Codex and other agents in this repository; needs Node 24 and an FFmpeg with libass (nix develop).
---

# Make shorts

The order of the steps. The rules behind them are in [AGENTS.md](../../../AGENTS.md); commands and their flags come from `shorts-studio --help` or the MCP tool list.

## Before you start

1. `config show`: everything must be ✓ except keys for later milestones. Stop and tell the user about any ✗.
2. `post list`: continue posts already in progress before starting new ones. `post show --post <slug>` names the next step every time.

## Flow A: original audio (a reel, a recording, a track)

1. `post create --post <slug> --title "…"`
2. `source import --post <slug> --file <audio-or-video> --origin mine|others|ai --kind speech|music`. Use `others` for someone else's reel: it's a guide track, and the post must be published with the platform's in-app sound.
3. `audio transcribe --post <slug>`. Add `--language es` only when the auto-detected language is wrong.
4. `beat plan --post <slug>`, then read the beats.
5. Write the story to `script.md` (hook in the first 3 s, the turn, the CTA) and one image prompt per beat to `prompts.json` (`[{"beat": 0, "prompt": "…"}]`): concrete subjects, one idea per image, the brand style is added for you.
6. `script set --post <slug> --file script.md`, then `beat set --post <slug> --from prompts.json`.
7. **Stop.** Ask the user to read the script and run `script approve --post <slug>` themselves. Never approve it.
8. `image generate --post <slug> --dry-run`, show the estimate, then run it for real (the CLI needs `--yes`; over MCP the user's approval prompt is the gate).
9. `draft render --post <slug>`, then give the user the path to `draft.mp4` for the evening check.

## Flow B: AI voice from a brief

Voice generation arrives in milestone 3. Until then: write the script, have the user approve it, record or generate the voiceover elsewhere, and continue from Flow A step 2 with `--origin ai`.

## Five a day

- Morning: take each post to step 7 and hand the user all five scripts at once.
- After approval: steps 8–9 for each approved post.
- Re-running any step is safe: finished work is skipped, an interrupted image request resumes without paying again.

## When something fails

Every error has a `fix`: do what it says. `over-budget` means stop and ask the user; never raise caps yourself. `needs-confirmation` means the step is the user's.
