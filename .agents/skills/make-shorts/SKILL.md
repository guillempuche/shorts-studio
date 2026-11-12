---

name: make-shorts
description: Run the daily short-video loop with shorts-studio - from audio or a brief to a reviewable draft per post, with the user approving each script and its image prompts before anything is spent on images. Use when asked to make, continue or batch short videos, reels or TikToks, or to prepare today's posts.
compatibility: Claude Code, Codex and other agents in this repository; needs Node 26 and an FFmpeg with libass (nix develop).
---

# Make shorts

The order of the steps. The rules behind them are in [AGENTS.md](../../../AGENTS.md); commands and their flags come from `shorts-studio --help` or the MCP tool list.

## Before you start

1. `doctor`: everything must be ✓. Stop and tell the user about any ✗.
2. `post list`: continue posts already in progress before starting new ones. `post show --post <slug>` names the next step every time.

## Flow A: original audio (a reel, a recording, a track)

1. `post create --post <slug> --title "…"`
2. `source import --post <slug> --file <audio-or-video> --origin mine|others|ai --kind speech|music`. Use `others` for someone else's reel: it's a guide track, and the post must be published with the platform's in-app sound.
3. `audio transcribe --post <slug>`. It costs a little, counted toward the caps: on a long file, show the `--dry-run` estimate first. Add `--language es` only when the auto-detected language is wrong.
4. `beat plan --post <slug>`, then direct the beats with the [story-direction skill](../story-direction/SKILL.md): mark each beat's moment, re-cut with `--by-moment`, then write one image prompt per beat.
5. Write the story to `script.md` (hook in the first 3 s, the turn, the CTA): concrete subjects, one idea per image, the brand style is added for you.
6. `script set --post <slug> --file script.md --hook "3 to 7 words"`, then `beat set --post <slug> --from beats.json`.
7. **Stop.** Ask the user to read the script and the prompts, and run `script approve --post <slug>` in their own terminal. Never approve it: it refuses without a terminal anyway. Changing a prompt or the audio afterwards needs approving again.
8. `image generate --post <slug> --dry-run`, show the estimate, then run it for real (the CLI needs `--yes`; over MCP the user's approval prompt is the gate).
9. `draft render --post <slug>`, then give the user the path to `draft.mp4` for the evening check.
10. **Stop.** The user reviews it with `post review --post <slug> --decision approve|fix|reject` (CLI only). For `fix`, read `post show` for their notes, change what they name (`beat set`, `image generate --beat N --reroll`, `image import`), and render again. A new prompt needs the user's `script approve` before `image generate`.
11. Once approved: `capcut export --post <slug>`; the user polishes in CapCut desktop (steps in `capcut/README.txt`). Then `post finalize --post <slug> --file <final.mp4>`, `post publish` once per platform, and `post archive` when it's done.

## Flow B: AI voice from a brief

Voice generation isn't built yet (openspec/changes/voice-music-animate). Until it is: write the script, have the user approve it, record or generate the voiceover elsewhere, and continue from Flow A step 2 with `--origin ai`.

## Five a day

- Morning: take each post to step 7 and hand the user all five scripts at once.
- After approval: steps 8–9 for each approved post; evening: steps 10–11.
- `budget show` before generating, so the day's spend stays visible.
- Re-running any step is safe: finished work is skipped, an interrupted image request resumes without paying again.

## When something fails

Every error has a `fix`: do what it says. `over-budget` means stop and ask the user; never raise caps yourself. `needs-approval` means the step is the user's: stop and ask them. `needs-confirmation` means show the user the estimate, then run the same command with `--yes`. A `failed` error that names a setting means stop and tell the user: their caps may not apply until `doctor` passes.

`nextSteps` in every result says what comes next as data: run a step whose `by` is `agent` (its `tool` and `args` over MCP, its `cli` in a shell), and hand the user each step whose `by` is `user`.
