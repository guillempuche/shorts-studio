# State-aware steps

## Why

An audit on 2026-11-12 ran the CLI and the MCP server in a sandbox, following `next` and `nextSteps` as an agent would. The steps look only at what exists, not at whether it still matches what it was made from, and the steps after the draft often go to the wrong owner. An agent that follows them does wrong or wasted work:

- New audio keeps the old transcript and beats, and nothing says so. `beat plan --force` then cuts the old words past the end of the new audio.
- After a prompt edit, `next` says `draft render`, which renders the old image. In the needs-fix loop `draft render` says "up to date" forever.
- A plain `beat plan` undoes a re-cut by moment, says the audio changed when it didn't, and its `--force` drops every prompt.
- A music post is sent to paid transcription forever, even after its beats, prompts and script exist.
- An archived post still spends, and `post publish` marks a post nobody approved as posted.

## What Changes

- **Next steps follow what's out of date, not only what's missing.**
  - A transcript made from other audio sends the post to `audio transcribe`.
  - Beats cut from an earlier transcript send it to `beat plan`, with `--force` and the number of prompts it drops when they have prompts.
  - A beat whose image no longer matches its prompt and seed, has a request in flight, or whose file is gone sends it to an `image generate` dry run for those beats.
  - A draft that `draft render` would render again comes before the user's review and before the export.
- **Every spending step starts with its dry run, transcription included.** It matches what the MCP server tells agents.
- **Music skips transcription.** A post whose audio is music goes from import to `beat plan`. Transcription that finds no words says to import the audio again as music.
- **The re-cut by moment is offered.** When beats have moments and no prompts, the next step is `beat plan --by-moment`, or writing the prompts.
- **`beat plan` keeps a current re-cut**, refuses while the transcript doesn't match the audio, and never ends a beat past the audio.
- **`draft render` refuses parts that are out of date.** It names the beats, with the post's next step as the fix. A missing image file fails with `not-found` and names `image generate` or `image import`. `image generate` makes a missing image file again with the same seed.
- **post.json records what each output was made from.** A transcript records its audio's hash, a beat plan the hash it was cut from, and a generated image its beat's prompt. The fields are optional and added beside the existing ones; no hash changes, so nothing already made goes out of date.
- **Review notes become steps.** A post that needs fixes lists one step per note, naming its beat and the tools that fix it. `post show` prints the review.
- **Each step after the draft goes to its owner.**
  - `capcut export`, `post finalize` and `post publish` refuse with `needs-approval` when the draft waits for the user's review (naming `--decision <decision>`) or was rejected. The user chooses to rework or archive it.
  - They refuse with `conflict` when the user asked for fixes, naming each note and `draft render`. **BREAKING** for scripts that match `needs-approval` (exit 3) on a draft that needs fixes: it's now `conflict` (exit 1).
  - `capcut export` works whenever the current review approves the draft, also after the final video. Its own next step starts at polishing in CapCut.
- **`post publish` needs an approved draft or a final video.** `post finalize` refuses a post that's already published, naming its platforms.
- **Archived posts stay as they are.** Their next steps are empty. Every command that changes or spends on a post refuses an archived one with `conflict` before anything is reserved or written. CLI runs by `--day` or `--in-stage` leave archived posts out unless they select stage `archived`. `post archive` returns the time it was first archived, with `next` and `nextSteps`.
- **Test fixtures count as up to date.** `withDraft()` gets a transcript, and seeded posts get the hashes the checks expect, so tests can reach the later stages.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agent-interface`: next steps that follow what's out of date, refusals after the draft by who acts next, and the review in `post show`.
- `media-pipeline`: beats that end with the audio and are cut from the current transcript, drafts rendered only from up-to-date parts, the CapCut export of any approved current review, and transcription without words.
- `post-manifest`: what each output records about its inputs, publishing and finalizing by review, and archived posts.

## Impact

- `packages/usecases/src/freshness.ts` (new): whether each output still matches the post's own inputs, read once per command, with the hash helpers that `beat.ts`, `draft.ts` and `image.ts` hold today.
- `packages/usecases/src/operations/`: `post.ts` (`nextStepsOf`, `nextOf`, `post show`'s text), `beat.ts`, `draft.ts`, `image.ts`, `capcut.ts`, `lifecycle.ts`, `audio.ts`, and every operation that returns `next` or refuses an archived post.
- `packages/domain/src/post.ts` (three optional fields), `packages/domain/src/beats.ts` (beats end with the audio).
- `packages/providers/src/together.ts` (the fix for audio without words).
- `apps/cli/src/cli.ts` (batches leave archived posts out).
- `packages/usecases/src/test/posts.ts` (fixtures).
- `schemas/post.schema.json`, `docs/architecture.md`, `CHANGELOG.md`, and the make-shorts and story-direction skills.
- Shared files with other open changes: spend-safety changes `image.ts`'s sending and rerolls, and agent-recovery changes `post.ts`'s `script_set` and `beat_set` steps, errors, and `cli.ts`'s post selection. See design.md.

Not part of this change:

- Making `image generate` itself ignore a new brand style or model. It still makes those images again when run; the next steps name only the beats whose own inputs changed.
- Recording the CapCut export in `post.json`. `post show` on an approved post still lists `capcut export` first.
- A command that takes a post out of the archive.
- Refusing `audio transcribe` on a music post.
- Letting beats already started finish when a cap is reached part-way: parallel-stories task 1.6 plans it.
- Inline script and beats, `nextSteps` on errors, and the `Next:` line of a text-mode transcription dry run: agent-recovery plans them.
- Telling the draft's look apart from its own inputs: renderer-text-layers plans it. This change reads both through one check, so that change has one place to edit.
- Bumping `outputVersion`, `PLANNER_VERSION` or `RENDERER_VERSION`.
