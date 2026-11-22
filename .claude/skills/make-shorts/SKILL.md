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
3. `audio transcribe --post <slug> --dry-run`, then the real run its next step names. It costs a little, counted toward the caps. Add `--language es` only when the auto-detected language is wrong. Music skips this step: `post show` goes straight to `beat plan`.
4. `beat plan --post <slug>`, then direct the beats with the [story-direction skill](../story-direction/SKILL.md): mark each beat's moment, re-cut with `--by-moment`, then write one image prompt per beat.
5. Write the story (hook in the first 3 s, the turn, the CTA): concrete subjects, one idea per image, the brand style is added for you.
6. `script set --post <slug> --text <script> --hook "3 to 7 words"` (or `--file script.md`), after the prompts are set with `beat set --post <slug> --beats <beats>` (or `--from beats.json`). Over MCP both go inline, as `post show`'s next steps write them.
7. **Stop.** Ask the user to read the script and the prompts, and run `script approve --post <slug>` in their own terminal. Never approve it: it refuses without a terminal anyway. Changing a prompt or the audio afterwards needs approving again.
8. `image generate --post <slug> --dry-run`, show the estimate, then run it for real (the CLI needs `--yes` when it costs money; over MCP the user's approval prompt is the gate).
9. `draft render --post <slug>`, then give the user the path to `draft.mp4` for the evening check.
10. **Stop.** The user reviews it with `post review --post <slug> --decision approve|fix|reject` (CLI only). For `fix`, `post show` lists one step per note, naming its beat: change what it names (`beat set`, `image generate --beat N --reroll --dry-run`, `image import`), follow the next steps, and render again. A new prompt needs the user's `script approve` before its image.
11. Once approved: `capcut export --post <slug>`; the user polishes in CapCut desktop (steps in `capcut/README.txt`). Then `post finalize --post <slug> --file <final.mp4>`, `post publish` once per platform, and `post archive` when it's done. A rejected draft is the user's call: ask whether to rework the post or archive it.
12. An archived post no longer changes: every command that would change it or spend on it refuses, and it can't be taken out of the archive. Start a new post for new work.

## Flow B: AI voice from a brief

Voice generation isn't built yet (openspec/changes/voice-music-animate). Until it is: write the script, have the user approve it, record or generate the voiceover elsewhere, and continue from Flow A step 2 with `--origin ai`.

## Five a day

- Morning: take each post to step 7 and hand the user all five scripts at once.
- After approval: steps 8–9 for each approved post; evening: steps 10–11.
- `budget show` before generating, so the day's spend stays visible.
- Re-running any step is safe: finished work is skipped, an interrupted image request resumes without paying again.

## When something fails

Every error has a `fix`: do what it says. `over-budget` means stop and ask the user; never raise caps yourself. `needs-approval` means the step is the user's: stop and ask them. `missing-key` means stop and ask the user to set the key it names. `needs-confirmation` means the run could go ahead: show the user the estimate, then run the same command with `--yes`. A `failed` error that names a setting means stop and tell the user: their caps may not apply until `doctor` passes.

Without `--yes`, a run that can't go ahead fails as the real run would (`over-budget`, `missing-key`, or `failed` for a setting), not with `needs-confirmation`. A run that spends nothing, such as fetching images already paid for, runs without `--yes`.

A dry run never fails for these: its `budget` says whether the real run could go ahead, and if not, `stoppedBy` says what stops it (`settings`, `missing-key`, or a cap such as `caps.dailyUsd`). Its `nextSteps` then start with the user's step for that. When some beats' images are already paid for, a later step fetches them at no cost (`image generate --post <slug> --beat <n,…>`, without `--yes`): run it.

An error's `nextSteps` work like a result's: its first step is what to do about it, and a step whose `by` is `user` means stop and ask the user, as its fix says. A batch fails with its posts' code: `needs-approval` (exit 3) or `over-budget` (exit 4) when they wait on the user, else the code they share, and its fix names the failed posts and the command on just those.

`nextSteps` in every result says what comes next as data, and follows what's out of date, not only what's missing: run a step whose `by` is `agent` (its `tool` and `args` over MCP, its `cli` in a shell), and hand the user each step whose `by` is `user`.
