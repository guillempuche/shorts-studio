# Architecture

How shorts-studio is built, and why. [README.md](../README.md) says what it does. [openspec/specs](../openspec/specs) says how each part must behave. For commands and flags, see `shorts-studio --help` or MCP `tools/list`.

## System overview

```
 apps/cli ──────────▶ packages/usecases ◀────────── apps/mcp
 shorts-studio         one Operation per command:     mcp serve (stdio)
 (effect/cli)          params (p.*) → CLI flags       (effect/ai McpServer)
                         + MCP Schema
                       run(input, Context, RunMode)
                       ports: Transcriber, ImageMaker,
                         MediaTools, Downloader
                          │                  ▲
                          ▼                  │ implements
                 packages/domain     packages/providers
                 post, beats,        FAL, Together, ffmpeg,
                 moments, motion,    yt-dlp, Node (settings,
                 captions, errors    keychain, processes)

 SHORTS_DATA_DIR: config.json, brand.json, ledger.jsonl
 SHORTS_POSTS_DIR/mine/<date-slug>/: post.json, audio/, images/, draft.mp4
```

The arrows are package dependencies, and they point inward. `domain` depends on nothing but Effect. `usecases` depends on `domain`. `providers` depends on both, because it implements the ports `usecases` declares. Only the apps see everything. Each package lists the packages it may import, so pnpm refuses an import that points the wrong way.

### One operation for both the CLI and MCP

Every command is an `Operation` in `packages/usecases/src/operations/`, listed in `operations/index.ts`. Its parameters are declared with `p.*` (`packages/usecases/src/operation.ts`). That one declaration gives both the CLI flag (kebab-case) and the MCP tool field (camelCase). `apps/cli` turns the list into `noun verb` commands, and `apps/mcp` turns it into `noun_verb` tools. Operations whose `surface` is `cli-only`, such as approving a script, are not offered over MCP. A test lists the MCP tools through Effect's in-memory client and checks that they match the list.

### Ports and providers

An operation takes plain values in a `Context` (folders, settings, `secret()`, `now`, `log`) and asks for outside work through ports (`packages/usecases/src/ports.ts`): `Transcriber`, `ImageMaker`, `MediaTools` and `Downloader`. Each port is an Effect service. Each provider in `packages/providers` is a layer that implements one or more ports, and says which API keys it needs and how `doctor` checks it.

Each paid provider ships its models as data (`FAL_MODELS`, `TOGETHER_MODELS`): the endpoint, the unit it's billed by, the price of one, the day that price was checked, and fields sent with every request. `modelsFor` (`packages/usecases/src/models.ts`) merges them with `config.json`'s `models`, and `chooseModel` picks one. The use case hands the whole model to the provider, so a model added in `config.json` needs no code. `costOf` prices a call from its model and its units.

`providersLayer` (`packages/providers/src/index.ts`) picks the provider for each job from `config.json` (`transcribe.provider`, `image.provider`). A fork adds a provider by writing its module and adding one line to the list for each job it does. No use case changes. Every paid provider (`Transcriber`, `ImageMaker`), and the in-memory fake of it that the use-case tests use, runs the same contract suite for its port, so they can't drift apart.

Settings come in layers: built-in defaults, then `config.json` and `brand.json`, then `SHORTS_*` environment variables, then flags. Each value comes from the highest layer that sets it, and the result is checked against the same Schema that publishes `schemas/config.schema.json` and `schemas/brand.schema.json`. A variable names exactly one setting (`SHORTS_CAPTIONS_FONT_SIZE` is `captions.fontSize`), so setting one never hides the rest of the file; `models` are set in `config.json` only (`packages/providers/src/node.ts`). A variable that isn't valid is left out and the others still apply, also when `config.json` itself isn't valid; then its own values fall back to the defaults, and `doctor` names the problem. A key in either file, or a `SHORTS_*` variable, that names no setting is a problem too, named with the closest setting (`closest` in `packages/domain/src/closest.ts`); the file's other settings still apply. A second decode with `onExcessProperty: "error"` finds those keys. `SHORTS_DATA_DIR`, `SHORTS_POSTS_DIR`, a provider's `SHORTS_<P>_URL` and the installer's `SHORTS_INSTALL_DIR` and `SHORTS_VERSION` aren't settings. Each problem (`settingsIssues`) names its file or variable and what it puts at risk: the caps (`config.json` dropped, or a cap's key or variable), the brand's style, or one setting. `capsFrom` says where each cap was set: its default, `config.json`, or a variable. API keys come only from the environment or the macOS Keychain, as `Redacted` values, so a key printed by mistake shows `<redacted>`.

Tests sit next to the module they test (`beats.ts` and `beats.test.ts`). Use-case tests provide in-memory fake ports; provider tests run against a local fake of the service.

### Errors

Every command fails with one `ShortsError` (`packages/domain/src/errors.ts`). It always says what went wrong (`message`) and what to do next (`fix`). A step that throws instead of failing still ends as one, with code `failed` (`defineOperation`), so `--json` and MCP keep their error shape whatever broke; its trace goes to stderr for the bug report. Its `reason` is a tagged error (`NotFound`, `Usage`, `OverBudget`, `MissingKey`, `ProviderFailed`, `Refused`, `RequestEnded`…), so code handles one kind with `Effect.catchReason`. The reason sets the stable `code` that scripts and agents match on, and the exit code.

## Data flow

### Import

`source import` uses ffmpeg to convert any audio or video to `audio/audio.m4a`. It records the duration, hash, origin (`mine`, `others`, `ai`) and kind (`speech`, `music`).

### Transcribe

`audio transcribe` sends the audio to the transcription provider (Together's Whisper large-v3 by default). It writes `transcript.json` with every word's start and end. Like every paid call, it reserves its price first, for the audio's minutes, but it needs no `--yes`.

### Beats and prompts

`beat plan` (`packages/domain/src/beats.ts`) groups words into phrases of 1.5–3 s. It cuts at pauses of at least 0.25 s or at sentence ends, and lays the beats back to back from 0 to the end of the audio. Long silences are split. Audio without words gets beats of equal length.

Next, the agent marks each beat's story moment with `beat set`. Then `beat plan --by-moment` cuts each stretch of one moment again, to fit that moment's length range. Last, the agent writes one image prompt per beat.

Moments, length ranges and motions are defined in `packages/domain/src/direction.ts`. The research behind them is in [docs/research](research/README.md).

### Images

`image generate` (`packages/usecases/src/operations/image.ts`) needs the approved script. `script approve` records the script, the audio and every beat's image prompt, so a change to any of them needs approving again. It works on each beat whose image is missing or out of date. For each one, it:

1. reserves the estimated cost in the ledger;
2. sends the request to FAL's queue;
3. saves the request in `post.json`;
4. checks back until the image is ready;
5. downloads it;
6. settles the reservation.

It works on three beats at a time. One real run at a time makes a post's images: it holds `images.lock` in the post's folder for the whole run, and `image import` and `beat plan` hold it for their write. It's taken before `post.json`'s or the ledger's lock, never while holding them, so they can't deadlock. A second run waits for it as for any lock, then fails with `conflict`, naming the first run's process and command. Under the lock, the run reads `post.json` again and fetches every chosen beat's saved request, in a pass of its own, before it reserves a new one, so a cap that stops a new request can't leave a paid one behind. It does so whatever the plan: a request sent for an earlier prompt, seed, model or style is fetched and settled too, and the beat gets a new request only if that image no longer fits (`fetchesSaved` in a dry run's plan). A saved request held by another image provider can't be fetched, so the run refuses that beat with `conflict`. Before anything changes, the run refuses on a setting that can't be used only when it would pay for something, and on a missing key only when it would send or fetch; so a run that only fetches saved requests goes ahead next to a broken setting.

Steps 1 to 3 run in a fiber that Ctrl-C doesn't stop. The run says on stderr that it waits up to 60 s for the provider's answer, saves the request, then stops, and the next run resumes it. No command drops a saved request before it's fetched: `--reroll` and `image import` refuse a beat that has one, and `beat plan` refuses while any beat has one, with `conflict`. They name `image generate --post <slug> --beat <n> --model <m>`, with the model that sent it, which fetches it at no cost; when the beat changed since its request, they say that run also pays for a new image. A reroll saves its new seed in the same write as its new request, so a reroll stopped before sending keeps the old seed. When a cap stops a run part-way, the `over-budget` error also names the beats it saved and the ones paid for but not fetched, with that free fetch.

### Draft

`draft render` first writes `captions.ass` and `captions.srt` (`packages/domain/src/captions.ts`). Each caption is a group of words within reading limits. It also adds the optional hook title. Then it runs one ffmpeg command (`packages/providers/src/ffmpeg-render.ts`) that:

- upscales each image and moves it for exactly its beat's frames, with the motion its moment calls for (or its override);
- joins the beats in order;
- burns in the captions with libass;
- adds the audio;
- encodes H.264 at 1080×1920 and 30 fps.

### After the draft

The user runs `post review` (CLI-only) to approve, ask for a fix (with notes per beat) or reject. The review stores the draft's hash, so a new render needs a new review.

`capcut export` (`packages/usecases/src/operations/capcut.ts`) renders one clip per beat, with its motion and exactly its frames from the draft. It also writes the audio (left out when it's someone else's), `captions.srt` and a clean draft.

`post finalize`, `post publish` and `post archive` record what happens after CapCut.

### Saved collections

`source download --collection` runs the user's own yt-dlp on the URLs in `<posts>/saved/<name>/urls.txt`. It keeps a download archive and pauses between downloads. `source transcribe --collection` writes transcripts with word times next to the audio.

## Data model

### post.json

The Schema lives in `packages/domain/src/post.ts`. `pnpm schemas` writes it to `schemas/post.schema.json`, and `schema show` prints it along with each command's schemas.

Only `updatePost` (`packages/usecases/src/post-store.ts`) writes the file, always to the folder it read it from, and only while the file's `slug` names that folder, so a copied folder can't write over the original. It takes the post's lock file, reads the file again, makes the change, replaces the file in one step, and adds 1 to `revision`. Long operations don't hold the lock the whole time. Instead, they save each finished piece with a short update.

Every generated output stores an `inputHash`. It covers the output's inputs, the hashes of the earlier outputs it was built from, and the version of the code that made it (`PLANNER_VERSION`, `RENDERER_VERSION`). An output is up to date only while that hash matches. So an edited prompt or a re-cut beat also makes everything built from it out of date.

`stageOf` works out the stage from `post.json`. The stage itself is never stored.

### Ledger

`<data>/ledger.jsonl` (`packages/usecases/src/ledger.ts`) is only ever added to. Each paid call adds a `reserve` entry before it starts, then a `settle` entry at the reserved amount or a `release` entry. Each entry records the units and the price of one. Reservations are checked against `caps.dailyUsd`, `caps.monthlyUsd` and `caps.postUsd` under one lock that every process shares, with days and months in the machine's time zone (`packages/usecases/src/days.ts`). Times are written in one form (`toISOString`), so they compare as strings; a line in another form, or with a negative amount, makes the read fail. What to do with such a line is the user's decision, since the caps are checked against it. The exception is an unfinished last line from a write that was cut off, which is safe to remove: a reservation's line is written before its request is sent, and a cut-off settle or release leaves its reservation counted in full.

A reservation is freed only when the failure proves nothing was billed (`nothingBilled`): a refusal (`Refused`, an HTTP 4xx on a submit), a job the provider reported failed (`RequestEnded`), a request that never left the machine (`NotSent`: a refused connection, a name that didn't resolve, a failed TLS handshake), or a call that stopped before sending, such as on a missing key. Anything else stays counted: a 5xx, a timeout, a connection reset that may have come after the request was written, or any failure while checking on a request the provider already took. `providerFailure` and `readFailure` (`packages/providers/src/env.ts`) sort each HTTP failure into these reasons, and each fix starts by saying whether the cost was counted.

## Agent interface

Results go to stdout. Progress and log messages go to stderr. With `--json`, stdout holds exactly one object, even when a command is given a flag or value it doesn't take, or is interrupted: `{ ok: true, outputVersion, command, result }` or `{ ok: false, outputVersion, command, error: { code, message, fix } }`. A run that selects more than one post (`--post a,b`, or `--day` or `--in-stage` matching several) holds `results`, one per post, in place of `result`. An interrupted run fails with `interrupted` (exit 130), printed from `Effect.onInterrupt` in `leaf` (`apps/cli/src/cli.ts`); its fix names the command to run again, and for `image generate` says saved requests are fetched without paying again and to leave out `--reroll`. A failed MCP call returns the same error object with `isError: true`. Arguments that don't match a tool's Schema, including a field the tool doesn't take (a misspelt `dry_run`), get the MCP library's own error instead, naming the field and the fields the tool takes: a JSON-RPC error on 2025-06-18, and a result with `isError: true` on 2025-11-25 and 2026-07-28.

Every result that moves a post on holds `next`, the command as text, and `nextSteps`, the same steps as data (`nextStepsOf` in `packages/usecases/src/operations/post.ts`). Each step says whether it's the agent's or the user's (`by`). An agent's step has its MCP tool and arguments (`tool`, `args`) and its CLI command (`cli`); a user's step, such as an approval, has no tool. A placeholder the agent fills in first, such as `<final.mp4>`, is listed in the step's `fill`. A spending step is its dry run first, and that dry run's next step is the real run when it could go ahead (`nextAfterDryRun`). When it couldn't, the steps start with the user's for what stops it: setting the key it names, deciding about the cap, or fixing the setting, followed by the agent's `config_check`. When some chosen beats have requests already paid for, a later step fetches them at no cost (`image_generate` with just those beats, no `--yes` in its `cli`), unless a missing key stops that too.

`mcp serve` speaks MCP 2026-07-28, where each request carries its own version, and 2025-11-25 and 2025-06-18 for clients that start with `initialize` (`MCP_PROTOCOLS` in `apps/mcp/src/mcp.ts`).

A dry run's result holds `budget`: what's left today, this month and on the post, and whether the real run could go ahead. It checks, in order, the settings (when there's something to pay for), the keys the real run would call the provider with (by presence, and even at $0, since fetching needs them), then the caps. When it couldn't go ahead, `stoppedBy` names what stops it (`settings`, `missing-key`, or the cap), and `why` and `fix` are the real run's message and fix. A batch dry run counts what it planned for earlier posts. When a spending command runs without `--yes`, the CLI runs its dry run first and reads that `budget` (`attempt` in `apps/cli/src/cli.ts`). When the run could go ahead, the one object holds both the estimate (`result`) and the request for confirmation (`error`, `needs-confirmation`). When it couldn't, the error is what the real run would fail with: `over-budget` past a cap, `missing-key` without a key, `failed` on a setting. When its estimate is $0, such as fetching requests already paid for, it runs for real, since `--yes` confirms spending and there's none; that run, being unconfirmed, still refuses anything that turned out to cost money. In a batch, each post gets its own outcome. While a setting in `config.json`, `brand.json` or a `SHORTS_*` variable can't be used, or names no setting, a paid call fails before it reserves anything, saying what's at risk: caps that may be the defaults, images without the brand's style, or one setting at its default. Other CLI commands name the setting on stderr, and `budget show` and `models list` list them in their result (`settingsIssues`), since an MCP client sees no stderr. An MCP server reads the settings and its environment when it starts, so it needs a restart after they're fixed; a key added to the macOS Keychain is read on every call. `config check` (`doctor`) also checks the data and posts folders and the ledger, and gives each row that isn't ok the code a command would fail with because of it (`code`: `failed`, `missing-key` or `missing-tool`), printed beside each blocking problem. `doctor` itself still fails with `missing-tool`.

Spending commands take `--dry-run` and need `--yes` on the CLI when they'd spend money, except transcription, which costs under a cent a post and runs before there is a script to approve. Over MCP they take `dryRun` instead, and the client's approval prompt does the job of `--yes`. `script approve` and `post review` refuse to run unless stdin is a terminal, and in a shell where an agent's marker is set (`CLAUDECODE`), so an agent can't record the user's decisions.

### Exit codes

| Code | Meaning                              | Error codes                                                                                                    |
| ---- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| 0    | Success, including `--dry-run`       |                                                                                                                |
| 1    | Failed                               | `failed`, `not-found`, `conflict`, `stale`, `missing-tool`, `missing-key`, `provider`                          |
| 2    | Usage error                          | `usage`, and unknown flags or commands                                                                         |
| 3    | Needs `--yes` or the user's approval | `needs-confirmation` (the run could go ahead: check the estimate, then `--yes`), `needs-approval` (the user's) |
| 4    | A spending cap would be passed       | `over-budget`                                                                                                  |
| 130  | Interrupted (Ctrl-C or `kill`)       | `interrupted`                                                                                                  |

## Key decisions

**Why one list of operations for the CLI and MCP, not two codebases:** an agent and a person must see the same commands with the same parameters. Building both from one declaration keeps them from drifting apart, and the parity test proves it.

**Why ports as Effect services, and plain values in `Context`:** the outside services are what a fork swaps, so each is a port with its own layer, chosen from the settings. Folders, settings and the clock never change shape, so they stay plain values that a test builds directly.

**Why a workspace of packages, not folders in one package:** package dependencies make the layers a rule, not a habit. The domain can't import a provider, because pnpm doesn't link one into it.

**Why `spawn` with `stopWhenAborted`, not Effect's process spawner:** on macOS and Linux, Effect's spawner starts each program in its own process group. When the run is interrupted, it stops that whole group. But if Node dies before it can, as when the terminal closes, the program keeps running, while one started with plain `spawn` is in the terminal's process group and gets its signal too. Effect's spawner also waits without limit for a program to exit after SIGKILL; `attempt` waits at most 10 s. The CLI provides a stub in its place (`apps/cli/src/platform.ts`), since `effect/cli` asks for one but never starts a program.

**Why models as data, not code:** models change often, and the same job is worth trying with several. A new model from a family a provider already handles is a `config.json` entry, and old ledger lines keep the price they were made with.

**Why keep a reservation when the outcome is unknown:** a gateway can answer 5xx after the provider took the job on, and a dropped connection says nothing either way. Freeing those would let the caps count less than was billed.

**Why reserve before sending, not record after:** if five posts generate at once, each would pass a check made after the fact. Reserving under one lock makes the cap hold.

**Why save the provider's request before waiting, not retry the call:** sending a request again can bill twice. Checking on the saved request after a crash can't.

**Why images 25% larger than the frame:** otherwise motion (zooms up to 15%, pans and drifts) would show the image's edges or have to upscale it. Also, ffmpeg's `zoompan` jitters on frames it hasn't upscaled.

**Why motion by story moment, not the same zoom on every beat:** the same movement all the time gets tiring. Moving in, pulling back and holding still each do a different job in a story ([docs/research/motion.md](research/motion.md)).

**Why approve the script, not only the draft:** rejecting a script costs nothing. Rejecting a finished draft wastes every image in it.

**Why local FFmpeg, not a render API:** there are no per-minute fees, it works offline and behind a VPN, and the beat timing stays exact.
