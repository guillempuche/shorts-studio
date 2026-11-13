## Context

The findings come from an audit on 2026-11-12 that followed `next` and `nextSteps` through the CLI and the MCP server in a sandbox. What the code does today (line numbers as of fe43a4723):

- `nextStepsOf(post)` (`operations/post.ts`) is pure. It walks `post.json` top-down and returns at the first gap. It checks only that each output exists:
  - `post.transcript === undefined`;
  - `post.beats === undefined`;
  - `b.prompt === undefined`;
  - `b.image === undefined`;
  - `post.draft === undefined`.

  The stage switch is reached only when everything upstream exists. So an archived idea gets `source import`, and a post published from the idea stage gets `image generate`.
- Each operation knows its own "up to date" rule, and nothing shares them:
  - `audio transcribe` compares `hashOf(audio.hash, provider, model, language)`.
  - `beat plan` compares `planInputHash` (`beat.ts:30`), which hashes `transcript.hash` and the audio's duration but not the audio's hash. A re-cut stores `hashOf("by-moment", planInputHash, sections)`, which a plain `beat plan` never equals, so it plans again over it (`beat.ts:105`).
  - `image generate` compares `imageInputHash`: the full prompt with the brand's style, the configured model, the seed and the size.
  - `draft render` and `capcut export` compare `draftInputHash`, which holds the images' hashes but not the prompts. It also holds the caption style and `MediaTools.rendererVersion`.
- Several outputs can't say what they were made from:
  - A transcript's `inputHash` folds in the audio's hash, but the language it was asked for isn't stored. The stored `language` is what the provider answered, which may be a name rather than the code that was asked for.
  - A re-cut's hash can't be undone to find the plan it came from.
- `planBeats` ends at `Math.max(durationSec, lastWord.end)` (`domain/src/beats.ts:74`). Words from older, longer audio push beats past the end.
- `capcut export` and `post finalize` refuse every stage but `approved` with `needs-approval` and a fix that says `--decision approve` (`capcut.ts:70`, `lifecycle.ts:120`). `post publish` has no stage check. `post archive` returns `ctx.now()` and no `next`.
- No operation reads `archivedAt`. `selectPosts` (`apps/cli/src/cli.ts:146`) matches archived posts by day.
- Every operation's `run` already has `Ports`, which includes `MediaTools`, in its environment, so asking for `rendererVersion` changes no signature.
- `beat plan` and `draft render` have no use-case tests. `withDraft()` (`test/posts.ts`) has audio but no transcript, so `nextStepsOf` sends it to `audio transcribe`, and every fixture's hashes are made up (`"b"`, `"x"`, `"h0"`).

## Goals / Non-Goals

**Goals:**

- One place decides whether each output still matches the post. Next steps, `beat plan`, `draft render` and the commands after the draft all ask it.
- Following `nextSteps` never sends an agent to work that does nothing (an up-to-date render), undoes work (a plain re-plan over a re-cut), or pays for work the post doesn't need.
- Each refusal names who acts next: the agent, or the user and the decision they make.

**Non-Goals:**

- Changing how `image generate` or `audio transcribe` decide what to make. Their hash rules stay, so nothing already made is paid for again.
- Changing any hash formula, `PLANNER_VERSION` or `RENDERER_VERSION`.
- Telling the draft's look apart from its own inputs. renderer-text-layers does that; this design leaves it one function to change.

## Decisions

### One check that reads the post's state, and pure steps

A new module, `packages/usecases/src/freshness.ts`, holds every "still matches" rule. `freshnessOf(ctx, post)` reads them once and returns plain data. It's an Effect that asks for `MediaTools`, for `rendererVersion`, and checks files with `existsSync`:

```ts
interface Freshness {
	transcript: "none" | "current" | "other-audio"; // speech only; music is always "none"
	beats: "none" | "current" | "stale";
	recut: boolean; // the beats are a re-cut of their current moments
	images: ReadonlyArray<{
		beat: number;
		imported: boolean;
		why: "none" | "changed" | "pending" | "file-gone";
	}>;
	draft: "none" | "current" | "stale"; // what draft render would do
	exportMatches: boolean; // what capcut export checks
}
```

`nextStepsOf(post, freshness)` stays pure. `nextOf(ctx, post)` and `nextStep(ctx, post)` become Effects that call both. Every operation that spreads `nextOf(post)` yields it instead. `planInputHash` (from `beat.ts`), `draftInputHash` and `captionStyle` (from `draft.ts`), and `imageInputHash` and `fullPrompt` (from `image.ts`) move into `freshness.ts`. So `post.ts` imports no operation and there's no import loop, the reason the agent-experience design gave for naming tools as strings.

`images` lists only the beats that need work. `draft` and `exportMatches` give the same answer today; renderer-text-layers will make `exportMatches` check only the post's own inputs.

Alternatives:

- Pass `ctx` and the renderer version into `nextStepsOf` and check files inside it. Rejected: the stage-walk test and every unit test would need real files, and the rules would still live in the operations.
- Store "out of date" flags in `post.json`. Rejected: a flag goes stale itself when a file is deleted or the renderer changes.
- Keep `nextStepsOf(post)` as it is. Rejected: it can't see a missing file or a new renderer, which the findings need.

### "Out of date" means the post's own inputs changed

Next steps and the commands that use an output (`beat plan`, `draft render`) count it as out of date only when something the post holds changed:

- a transcript, when the audio changed;
- beats, when the transcript changed (or, for music, the audio);
- an image, when its beat's prompt or seed changed, a request for it is in flight, or its file is gone;
- the draft, by `draft render`'s own rule, because rendering again is free and the user should review what the renderer makes now.

A new provider, model or brand style doesn't count. The commands that make outputs keep their own hash rule: `image generate` still makes an image again when the brand style changes.

So the steps and `image generate` can disagree after a settings change. The image step passes `beat` with the beats that need work (`{ post, beat: "1,3", dryRun: true }`), so the dry run plans only those. It leaves `beat` out when no beat has a usable image.

Alternative: recompute every output's `inputHash` with today's settings. Rejected: a new image model or brand style would make every image out of date, and `draft render` would refuse to render until all of them were paid for again.

### Record what each output was made from, and read older posts by their hashes

Three optional fields go into the Post Schema. No hash changes, so nothing already made goes out of date, and `image generate` still finds older images up to date (the test "should keep an image made by an earlier version up to date").

| Field                        | Written by                                        | Holds                                                      |
| ---------------------------- | ------------------------------------------------- | ---------------------------------------------------------- |
| `transcript.audioHash`       | `audio transcribe`                                | the hash of the audio it transcribed                       |
| `beats.sourceHash`           | `beat plan`, plain and `--by-moment`              | `planInputHash` when the beats were cut, before any re-cut |
| `beats.items[].image.prompt` | `image generate`, also when it picks up a request | the beat's prompt, without the brand style                 |

Posts made before this change lack them, and are judged by what can be recomputed:

- **Transcript:** it matches the audio when its `inputHash` equals `hashOf(audio.hash, provider, model, x)` for the recorded provider and model, with `x` being `"auto"` or the recorded language.
- **Beats:** they're current when `inputHash` equals the plain hash, or the re-cut hash of their current moments. A plan with moments next to a transcript without `audioHash` also counts as current. Both were made before this change, and a moment edited after a re-cut looks the same as a stale plan. New audio is still caught: the transcript step comes first, and a new transcript records `audioHash`.
- **Image:** it matches when `inputHash` equals `imageInputHash` with the recorded model, the beat's seed and today's brand style.

Alternative: change the hash formulas to hold these inputs. Rejected: every saved plan and image would turn out of date at once. Planning again drops prompts, and making images again is paid.

### The order of the steps

`nextStepsOf(post, f)` returns the first of these that applies:

1. An archived post has no steps.
2. A post at `final` or `posted` gets its stage's steps. The video is finished, so nothing upstream matters.
3. No audio and no script: `source import`, or `script set`.
4. Speech whose transcript is `none` or `other-audio`: an `audio_transcribe` dry run. Music skips this step.
5. No beats: `beat_plan`.
6. Stale beats: `beat_plan`, with `force: true` and a note saying how many prompts it drops when the beats have prompts. Beats re-cut from an older transcript are planned plainly, and the note says to mark the moments again.
7. A beat without a prompt:
   - when no beat has a prompt, some beat has a moment, and `recut` is false: `beat_plan { byMoment: true }`, or `beat_set`;
   - otherwise: `beat_set`.
8. No script: `script set`. Not approved: the user's `script approve`.
9. No audio (the script-first flow): `source import`.
10. Images:
    - beats with `why` of `none`, `changed`, `pending`, or a generated image's `file-gone`: an `image_generate` dry run, as above;
    - an imported image's `file-gone`: a note naming `image import --beat N`. Its `beat` is an integer, and `NextStep.args` takes only strings and booleans.
11. No draft: `draft_render`.
12. The stage:
    - `draft`: when `f.draft` is stale, `draft_render`; then the user watches it and runs `post review --decision <decision>`.
    - `approved`: when `exportMatches` is false, `draft_render`; otherwise `capcut_export`, polishing in CapCut, then `post_finalize`.
    - `needs-fix`: `draft_render`.
    - `rejected`: when `f.draft` is stale (the agent reworked it), `draft_render`; otherwise the user's call to rework or archive.

At `needs-fix`, the review's notes go in front of whatever step comes out of this list (see below). After a fix, the next step can then be the user's `script approve` or an images dry run, with the notes still shown.

`capcut export`'s own result drops its `capcut_export` step, so its next step is polishing in CapCut.

### Transcription is a dry run first

The step after import is `audio_transcribe { post, dryRun: true }`. That dry run's next step is already the real run (`nextAfterDryRun`). The MCP server's instructions say to call spending tools with `dryRun` first, and AGENTS.md says the same for agents in the repo. One rule with no exception is easier to follow than "except transcription". It costs one more call per post. Transcription still needs no `--yes`.

Alternative: keep the real run, and add "except `audio_transcribe`" to the server's instructions and the skill. Rejected for now: it saves one call worth under a cent, and makes the rule harder to state.

### Music skips transcription, and the no-words error points at music

`audio.kind === "music"` skips step 4: `beat plan` already ignores the transcript for music (`beat.ts:25`), and so do the captions (`draft.ts:91`). `audio transcribe` still runs when it's asked for, since a later change may use lyrics. Together's "no word timings" fix (`together.ts:104`) says to import the audio again with `--kind music` if it has no speech. Whether that failure frees its reservation is for spend-safety to decide, with the other failure classes.

Alternative: refuse `audio transcribe` on a music post. Rejected for now: next steps no longer lead there, and refusing would block a deliberate run.

### `beat plan` keeps a current plan, refuses a mismatched transcript, and ends with the audio

- Before planning speech, it fails with `stale` when `transcript` is `other-audio`. The fix is `audio transcribe --post <slug> --dry-run`, then `beat plan`.
- A plain `beat plan` is skipped when `beats` is `current`, also for a re-cut. It plans again only with `--force` or when the plan is stale. The stale message says the beats were cut from an earlier transcript (or audio), not "the audio or transcript changed".
- `--by-moment` refuses with `stale` when the beats are stale. Their moments mark time ranges of the old words, so re-cutting them would mean nothing.
- Both paths write `sourceHash`.
- `planBeats` ends at `durationSec`: words that start at or after it are dropped, and a word end past it is cut back to it. `PLANNER_VERSION` stays at 2. Bumping it would make every saved plan stale, and planning again drops the prompts. A plan made earlier only differs when words ran past the audio, and those plans are caught by the transcript check.

### `draft render` refuses parts that are out of date

`draft render` calls `freshnessOf` before it writes anything:

- An image with `why: "none"`, or with `file-gone`, fails with `not-found`, naming the beats. The fix is `image generate --post <slug> --beat N --dry-run` for a generated image, or `image import --post <slug> --beat N --file <image>` for an imported one.
- A stale transcript or stale beats, or an image whose `why` is `changed` or `pending`, fail with `stale`. The message names the beats, and the fix is the post's next step. That step is the user's `script approve` when a changed prompt waits for approval, and the image dry run otherwise.

This ends the needs-fix loop. A prompt edit now leads to approval, then images, then a render that does something.

### `image generate` makes a missing file again

In `image generate`'s plan, a generated image whose file is gone counts as missing: `generate`, with the beat's seed, priced like any other. An imported image stays `skip` (it can't be made again), and draft render names `image import` for it.

Alternative: keep `skip`, and make the fix `--reroll`. Rejected: a reroll changes the seed for no reason, and the next step would have to explain it.

### Steps after the draft go to who acts next

One helper, `refuseUnapproved(ctx, post, command)` in `operations/post.ts` (which every operation already imports), is used by `capcut export`, `post finalize` and `post publish`. It reads `currentReview(post)`:

| Current review     | Code             | Fix                                                            |
| ------------------ | ---------------- | -------------------------------------------------------------- |
| none, draft exists | `needs-approval` | `post review --post <slug> --decision <decision>` (the user's) |
| `reject`           | `needs-approval` | ask the user whether to rework the post or archive it          |
| `fix`              | `conflict`       | each note, then `draft render`; the user reviews the new draft |
| none, no draft     | `not-found`      | the post's next step                                           |

Whether each command may go ahead:

| Command         | Goes ahead when                                                                                                  |
| --------------- | ---------------------------------------------------------------------------------------------------------------- |
| `capcut export` | the current review approves the draft (stages `approved`, `final` or `posted`) and `exportMatches`               |
| `post finalize` | the current review approves, or a final video exists; at `posted` it fails with `conflict`, naming the platforms |
| `post publish`  | the current review approves, or a final video exists (so a published post can add another platform)              |

`needs-fix` moves from `needs-approval` (exit 3) to `conflict` (exit 1). It's marked **BREAKING** in the CHANGELOG. Exit 3 tells an agent to stop and ask the user, but the user already answered: the fixes are the agent's.

Alternatives:

- `stale` for `needs-fix`. Rejected: here `stale` means "an output no longer matches its inputs", and the draft does match them.
- Require a final video before `post publish`. Rejected: a draft the user approved may be published as it is, without CapCut.

### A rejected post is the user's call, and can be reworked

At `rejected` with nothing changed, the step is the user's: `post archive --post <slug>`, with a note asking whether to rework the post or archive it. No tool is named. When the user says to rework it, the agent changes what they asked for. The steps then follow what's out of date, and the next render puts the post back at `draft`.

Alternative: make `rejected` final and refuse changes. Rejected: a rejected post can still be worth saving, and its images are paid for.

### Archived posts refuse changes up front, and stay archived

- `refuseArchived(post, command)` (in `post-store.ts`) fails with `conflict`: "<slug> is archived; it no longer changes." Each operation that changes a post or spends calls it right after its first read, before any reservation or write:
  - `source import` and `source download --post`;
  - `audio transcribe`, `beat plan`, `beat set`;
  - `script set`, `script approve`;
  - `image generate`, `image import`, `draft render`;
  - `post review`, `capcut export`, `post finalize`, `post publish`.

  An operation that starts with `updatePost` makes the check inside its change.
- `updatePost` itself doesn't refuse. A command that was already running when the post was archived still saves what it paid for.
- `post archive` keeps the first `archivedAt` and returns it, with `next` and `nextSteps`.
- `selectPosts` drops archived posts unless `--in-stage archived` is given. A post named with `--post` gets the refusal.
- There's no command to take a post out of the archive. Once attempt-history lands, archiving deletes the attempts that weren't kept, so going back couldn't restore them anyway.
- At `posted`, `post_archive` stays the agent's step, as make-shorts already tells agents to archive when a post is done.

A test lists every operation whose `post` is required, except `post_show` and `post_archive`, from a table of valid arguments. It fails when an operation is missing from the table. For each one it checks the refusal, an unchanged ledger and an unchanged `revision`.

Alternative: add `post unarchive`. Not now: nothing in the audit needed it, and it would have to say what it can't bring back.

### Review notes are steps, and `post show` prints them

At `needs-fix` the steps start with the agent's notes:

- one for the review's note: `the user's note: "<note>"`;
- one per beat note: `beat 1: "too dark": change it with beat set (prompt, moment or motion; a new prompt needs the user's script approve), image generate --beat 1 --reroll --dry-run, or image import --beat 1`.

They have no tool, because which fix fits depends on the note. The text output of `post show` prints the current review: its decision, time and note, and one line per beat note.

### Fixtures that count as up to date

- `withDraft()` gets a transcript.
- A new `seedUpToDate(ctx, slug, fields)` seeds a post, then fills in every recorded hash from `freshness.ts`: `audioHash`, `sourceHash`, image prompts, and the draft's `inputHash` with the fake renderer's version.
- Use-case tests that start from a later stage use it.
- `nextStepsOf` unit tests pass a `Freshness` they build, with `UP_TO_DATE` as the base, so the stage walk covers each kind of out-of-date output without files.

### Effect APIs

The new code uses only APIs these modules already use: `Effect.gen`, `Effect.fn`, `yield* MediaTools`, `Effect.sync` and `Effect.forEach`. They were checked in `packages/usecases/node_modules/effect/dist/Effect.d.ts` (4.1.2): `sync` at line 1656, `forEach` at 972 and `fn` at 18880.

### Decisions the user confirmed

The user confirmed every recommendation below on 2026-11-13.

Each is decided above; these change what the user sees:

1. Transcription's step is a dry run first, against keeping the real run with an exception in the instructions.
2. A rejected post is the user's call, to rework or archive, and can be reworked, against making `rejected` final.
3. No un-archive: an archived post refuses every change, against adding `post unarchive`.
4. Music skips transcription in the steps, but `audio transcribe` still runs when asked, against refusing it.
5. `post publish` accepts an approved draft without a final video, against requiring `post finalize` first.
6. `post finalize` on a published post refuses, against replacing the final video.
7. A missing image file is made again with the same seed, against requiring `--reroll`.
8. `needs-fix` refusals change from `needs-approval` (exit 3) to `conflict` (exit 1).
9. A new image model or brand style doesn't send posts back to `image generate`, against treating them as out of date.

## Risks / Trade-offs

- [Older posts judged by their hashes] Three cases go wrong:
  - a transcript made with a forced language, when the provider answered a name such as "spanish", reads as made from other audio;
  - an image made before a brand-style change reads as changed;
  - a re-cut whose moments were edited, with an older transcript, reads as current.

  → Each output records its inputs the next time it's made. The first two cost a dry run to see, and nothing is spent without it. Few posts were made before this change.
- [Steps and `image generate` disagree after a settings change] → The image step names its beats, so the dry run plans only those. A plain `image generate` still plans every beat the new settings affect, and its dry run shows that.
- [More reads per command] `freshnessOf` checks one file per image plus the draft. That's a few `existsSync` calls per command. `post list` doesn't call it.
- [A caption or renderer change puts approved drafts back to review] `exportMatches` equals `draftInputHash` today, as `capcut export` already checks. → renderer-text-layers narrows it to the post's own inputs.
- [Shared files with other open changes]
  - spend-safety changes `image.ts`'s sending, rerolls and pending requests. This change touches only the plan (`file-gone`) and the saved image (`prompt`).
  - agent-recovery changes the `script_set` and `beat_set` steps' arguments, gives errors `nextSteps`, and validates `selectPosts`. This change adds the by-moment step before `beat_set` and drops archived posts in `selectPosts`. Each needs a rebase onto whichever lands first.
  - Once errors carry `nextSteps`, `draft render`'s `stale` refusal should carry the post's steps.
- [A post archived while a command runs] Its results still save, and the post stays archived. → The post is changed after it was archived, but nothing paid for is lost.

## Migration Plan

- No data migration. The new fields are optional. Each is filled the next time its output is made.
- `pnpm schemas` regenerates `schemas/post.schema.json`.
- Rollback: the older code decodes `post.json` with Effect's default, which ignores unknown keys. So it reads posts written by this change, and drops the three fields on its next write. Those posts then fall back to the rules for older posts.
