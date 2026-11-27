# Changelog

Notable changes, newest first. The release workflow publishes each version's section as its release notes. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Build several changes at once in git worktrees ([docs/worktrees.md](docs/worktrees.md)). In a worktree, `bin/shorts-studio` runs in a sandbox: scratch posts, fake keys, paid providers unreachable. Opening a session there installs the packages and says which change it builds, and Claude Code refuses the `shorts-studio` MCP tools, which would run the main checkout's code.
- Install with `nix run github:guillempuche/shorts-studio` or native binaries (`install.sh`, `install.ps1`).
- `doctor` and `schema show`.
- Run one command on several posts with `--post a,b`, `--day` or `--in-stage`.
- Choose the transcription and image provider in config.json (`transcribe.provider`, `image.provider`). `doctor` checks only the keys of the providers in use.
- Any setting can come from a `SHORTS_*` environment variable, which wins over config.json and brand.json, such as `SHORTS_IMAGE_MODEL=flux-dev`.
- JSON Schemas for config.json and brand.json in `schemas/`, with a description for every setting, so editors complete and check them. `schema show --name config` prints one.
- Models are data: each provider ships its models with the price per unit and the day it was checked. `models` in config.json adds a model or changes a price, with no code. `models list` shows them all and the one each job uses.
- A monthly spending cap, `caps.monthlyUsd` ($100 by default), next to the daily and per-post caps. `budget show` reports the month.
- `doctor` warns when the price in use was checked more than 90 days ago, or when a model in config.json belongs to no provider in use, and fails when a job's model can't be used.
- CI builds the Linux, macOS and Windows binaries and runs them through `scripts/smoke-binary.ts`, and the release runs it before publishing, since the binaries run on Bun while the tests run on Node.
- The MCP server speaks MCP 2026-07-28, so a client on the newest version is served instead of getting an internal error. Clients on 2025-11-25 and 2025-06-18 keep their version.
- Every result that moves a post on has `nextSteps` next to `next`: each step's MCP tool and arguments, its CLI command, and whether it's the agent's or the user's.
- A dry run says whether its estimate fits the caps (`budget`), and which cap stops it if not. A batch dry run counts the posts before it, and a dry run that won't fit leaves the next step to you.
- A post not found by a slug that's one post's slug without its date suggests that post.
- `budget show` says where each cap was set (its default, `config.json`, or a `SHORTS_CAPS_*` variable), and `budget show` and `models list` list every setting that can't be used (`settingsIssues`), so an MCP client sees them too.
- `doctor` checks the data and posts folders and the spend ledger, and each row that isn't ok carries the code a command would fail with because of it (`code` in `config show --json`, in brackets beside each blocking problem). `doctor` itself still fails with `missing-tool`.
- A dry run also checks the keys the real run would call the provider with, by presence, even at $0 since fetching needs them (`stoppedBy: "missing-key"`), and its `budget` holds the real run's message and fix (`why`, `fix`). Its next steps start with the user's step for what stops it: setting the key, deciding about the cap, or fixing the setting, then `config_check`. When some beats' images are already paid for, a later step fetches them at no cost.
- Next steps follow what's out of date, not only what's missing: new audio sends the post back to transcription, beats cut from an earlier transcript to `beat plan --force` (saying how many prompts it drops), an image whose prompt or seed changed, has a request in flight or lost its file to an images dry run for just those beats, and a draft that would render again before the review or the export. Music skips transcription, the re-cut by moment is offered when beats have moments and no prompts, the user's review notes become one step each, and every spending step starts with its dry run, transcription included.
- `post.json` records what each output was made from: a transcript its audio's hash, a beat plan what it was cut from, and a generated image its beat's prompt. Posts made before are judged by their hashes, so nothing already made goes out of date.
- `post show` prints the user's review, with each beat's note, and `post archive` returns the first time the post was archived, with its (empty) next steps.
- Ctrl-C prints the run's error with the new code `interrupted` (exit 130), as one object with `--json`; its fix says to run the same command again, and for `image generate`, that saved requests are fetched without paying again and to leave out `--reroll`. Ctrl-C while an image request is being sent says it waits up to 60 s to save it.
- Errors carry `nextSteps` too, in the shape results use: when a fix names a step, each step's MCP tool and arguments, its CLI command, and whose it is. A step only the user can take, such as an approval, setting a key or a CLI-only download, is `by: user`. The MCP server's instructions say how a CLI command in a fix maps to its tool.
- `script set --text` and `beat set --beats` take the script and the beats' settings inline (over MCP, `beats` is the list itself), so an agent with only the MCP tools can take a post to the user's approval. Next steps pass them inline, with `<script>` and `<beats>` to fill in, and the beats step names the beats to fill and the shape of each.
- `post list` lists every post it can read and names each one it can't, with its error and fix (`unreadable`), so one damaged post.json no longer hides the others.
- `source transcribe` gives `next` and `nextSteps` after a dry run and after failed files, and lists each failed file with its error's code and fix (`failures`). A dry run lists a file it can't read instead of failing, and a cap reached part-way says how many files were transcribed and kept.
- `schema show` takes a command as the CLI writes it (`image generate`), and lists the commands that are CLI only (`cliOnly`).
- `config show` and `doctor` warn when a `SHORTS_<PROVIDER>_URL` variable sends a provider's requests to another address.
- `--version --json` prints one object.
- A usage error names the flag meant: `--in-stage` for a batch command given `--stage`, `--stage` for `post list` given `--in-stage`, and `--post a,b` for `--post` given twice.

### Changed

- **BREAKING:** a batch with failed posts fails with their code, not always `failed`: the code they share, else `over-budget`, else `needs-approval`, else `failed`. So it can exit 2, 3 or 4, not only 1. Its fix names the failed posts, and, unless they wait on the user, the same command on just those posts.
- **BREAKING:** `--post` together with `--day` or `--in-stage` is refused (exit 2), instead of `--post` being ignored, and so is a `--day` that doesn't exist, such as `2026-13-45`. A batch by `--day` reports a post it can't read as that post's failure; one by `--in-stage` leaves it out and names it on stderr.
- **BREAKING:** input that can't be right is refused with `usage` (exit 2) before anything is saved, reserved or sent:
  - `beat set`: a blank prompt, a beat named twice, a `--from` file or `--beats` item with a key a beat doesn't take (such as rows copied from `beat plan`'s output), and more than one of `--beats`, `--from` and `--beat`.
  - `script set`: an empty script, a hook that isn't 3 to 7 words (`--hook ""` removes it), and both `--text` and `--file`.
  - `image generate --beat`: anything but beats of the post, such as `7` on a post with two beats, `0x`, `1.5` or `-1`.
  - `image import`: a file that isn't a JPEG, PNG or WebP by its content, whatever its name. The copy is named by what it holds.
  - `source import`: a folder, a file ffmpeg can't read, one with no audio track, and silent audio (peak at or below −60 dBFS). The error names the file given, never the temporary one.
  - `post create`: an empty name, a slug over 100 characters, and a leading date that doesn't exist.
  - `post publish`: a URL without an `http` or `https` scheme and a host, such as `https://`.
- **BREAKING:** `budget show --post` with a name that no post, saved collection or spending goes by fails with `not-found`, suggesting the post meant. A post with nothing spent shows $0.
- **BREAKING:** `source download --collection` fails before running yt-dlp when urls.txt isn't a file or holds no URL, and fails with `provider` and yt-dlp's error lines when nothing new came down. `--url` and `--post` each need the other. When yt-dlp prints no ERROR line, its last 5 lines are kept.
- MCP tools publish their input with `additionalProperties: false`, and `schema show` does the same for command inputs, the objects inside them included.
- A fix for the user's step says to ask the user: approvals, a missing key, a setting `doctor` names, a post.json that can't be read, and a collection with no audio. The missing key's fix says a running MCP server reads a key put in the Keychain on its next call, while one set in the environment needs a restart.
- A post.json that isn't JSON says so, and its fix says to restore it or move the post's folder out of `posts/mine`; one with bad fields says "the fields named in the message", not "named above".
- A relative path is read from the folder shorts-studio runs in, which for MCP is where the server started, and an error about the file names its full path.
- A slug without its date that matches posts from several days names them all, with a step for each.
- The text of every dry run ends with `Next:`.

- **BREAKING:** `capcut export`, `post finalize` and `post publish` on a draft whose user asked for fixes fail with `conflict` (exit 1), naming each note and `draft render`, instead of `needs-approval` (exit 3): the fixes are the agent's. A draft waiting for its review, or rejected, still fails with `needs-approval`.
- **BREAKING:** an archived post no longer changes: every command that changes a post or spends on it refuses an archived one with `conflict` before it reserves or writes anything. `--day` and `--in-stage` leave archived posts out unless you select stage `archived`.
- `post publish` needs an approved draft, a final video or a post already published, and `post finalize` refuses a post that's already published. `capcut export` works whenever the current review approves the draft, also after the final video.
- `beat plan` keeps a current plan, also a re-cut by moment, refuses while the transcript was made from other audio, and ends the last beat where the audio ends. `draft render` refuses an image that no longer matches its prompt, has a request in flight or lost its file, and `image generate` makes a lost image file again with its seed.
- Transcription that finds no words says to import the audio again as music.

- **BREAKING:** a key in `config.json` or `brand.json`, or a `SHORTS_*` variable, that names no setting stops paid calls like a value that isn't valid, and `doctor` names it with the closest setting (`caps.daily` → `caps.dailyUsd`). The file's other settings still apply. Folder, address and installer variables aren't reported.
- **BREAKING:** a step that waits on the user's approval fails with the new code `needs-approval`, still exit 3: `script approve` and `post review` from an agent, `image generate` on an unapproved script, `capcut export` and `post finalize` on an unapproved draft. `needs-confirmation` now only means "check the estimate, then run it again with `--yes`". A CapCut export of a draft that changed after approval fails with `stale`.
- **BREAKING:** without `--yes`, `image generate` asks for it (`needs-confirmation`, exit 3) only when the run could go ahead. One that can't fails as the real run would: `over-budget` (exit 4) past a cap, `missing-key` or `failed` (exit 1) for a key or a setting. One that spends nothing, such as fetching images already paid for, runs without `--yes`. In a batch, each post gets its own outcome.
- `image generate` and `source transcribe` refuse on a setting that can't be used only when they'd pay for something, and on a missing key only when they'd send or fetch something, so fetching images already paid for works next to a broken setting.
- `script approve` and `post review` also refuse in an agent's shell (`CLAUDECODE` set), even with a terminal.
- `next` points images at `image generate --dry-run` first, instead of straight at `--yes`.
- The over-budget fix says where waiting helps and that raising a cap is the user's decision, instead of telling the reader to raise it.
- `doctor`'s fix names `config show --json`, which lists every check with its status and fix.
- `script approve` covers the audio and every image prompt, not just the script: changing any of them needs approving again, and `next` says what changed. Posts approved before need approving again.
- `script approve` and `post review` run only from a terminal, so no agent can record your decision. The Claude Code and Codex rules also catch them with flags placed first.
- `audio transcribe` and `source transcribe` take `--dry-run` and show their cost. They still run without `--yes`, and the agent settings ask before them.
- Every paid call is priced by its units (megapixels or images, minutes of audio) times its model's price, and each ledger line records both, so a later price change doesn't move past totals. Transcription counts toward the caps.
- Days and months follow the machine's time zone, not UTC, for the caps, new post dates and `--day today`. `TZ` sets another zone, in any of its forms; one that names no zone falls back to UTC, and `doctor` warns.
- A spending reservation is freed only when nothing was billed: a refusal (HTTP 4xx), a job the provider reported failed, or a call stopped before sending. After a 5xx or a dropped connection it stays counted.
- When a call would pass several caps, the error names the per-post cap first, then the month's, then the day's, and says to wait only where waiting helps.
- `transcribe.model` names a model from `models list`. Another Together model needs an entry under `models` first.
- A ledger line whose time isn't written as commands write it, or whose amount is negative, makes the ledger read fail, naming the line.
- Beats: a silence before the first word, inside a short phrase or before the last word gets beats of its own. Plans made before are stale.
- Captions: a lone word joins its neighbour only within 4 words and never across a pause.
- The code is a workspace: `apps/cli`, `apps/mcp`, and packages for the domain, the use cases and the providers, built with Turbo and kept in step by syncpack.
- Node 26 runs the TypeScript directly; there is no build step.
- `transcript.json`, lock files and ledger lines are read through their Schemas, so a damaged file names the bad field and the fix.
- API keys are held as redacted values, so a key printed by mistake shows `<redacted>`.
- A failed paid call's fix starts by saying whether its cost was counted, and what running it again does: nothing counted after a refusal or a request that never left the machine, counted and paid again after an unknown outcome.
- A paid call refused because of the settings says what's at risk: caps that may be the defaults, images without your brand's style, or one setting at its default. Its fix names `doctor` and `config_check`.
- The over-budget fix names where its cap was set: a `SHORTS_CAPS_*` variable, `config.json`, or its default.
- Every settings and key row in `doctor` says to restart a running MCP server after the fix, since it keeps the settings and environment it started with; on macOS, a key added to the Keychain needs no restart.
- A corrupt ledger line's fix leaves what to do with it to the user, since the caps are checked against the ledger, except an unfinished last line from a write that was cut off, which it says to remove.
- Dollar amounts show as many decimals as it takes to tell them apart: an amount above $0 never shows as $0.00 (~$0.0003), and one below its cap never shows as equal to it. Amounts in JSON results are rounded to millionths of a dollar.
- A busy post or spend ledger names the process holding its lock, what it's running and since when, and the lock file, which the fix says to delete if that process isn't shorts-studio.
- `image generate` fetches every saved request before it sends a new one, even one sent for an earlier prompt or another model, which it no longer replaces with a new request, and a run stopped by a cap names the beats it saved and those paid for but not fetched, with the command that fetches them at no cost. That command names the model that sent each request, and says when it also pays for a new image. `beat plan` refuses while a beat has a saved request, and waits while `image generate` runs on the post.
- The MCP tool `image_generate` is no longer marked idempotent, since calling it twice with `reroll` pays twice.

### Fixed

- A `config.json`, `brand.json` or `SHORTS_*` setting that can't be used no longer lets a paid call spend against the default caps, which can be higher than yours: it fails before reserving anything, and other commands name the setting on stderr.
- An MCP tool call with a field the tool doesn't take, such as `dry_run` for `dryRun`, fails and names the fields it takes, instead of dropping the field and spending.
- `--help` describes `models`.
- A `SHORTS_*` variable whose name starts like another setting's, such as `SHORTS_CAPTIONS_FONT_SIZE`, no longer makes config.json unreadable, which had put the spending caps back to their defaults. A variable with a value that isn't valid is reported by `doctor` and left out; config.json and the other variables still apply, and valid variables apply even when config.json isn't valid. A number or yes/no written as text in config.json (`"dailyUsd": "1"`) is still read as that value. A `SHORTS_MODELS_*` variable no longer replaces config.json's models.
- With `--json` (or `--json=true`), a command called wrong, or a group of commands given no command such as `post`, prints one JSON error object instead of help, and a run on several posts where some failed ends with the error object too. `doctor --json` names itself `doctor`.
- A file that can't be read or written (a folder in its place, no permission, a full disk) fails with a fix, instead of a stack trace and, with `--json`, no JSON at all. An unexpected failure ends the same way, with its trace on stderr. An image that was paid for but couldn't be saved is fetched again, free, on the next run.
- A lock file that can't be read no longer makes a command hang, Ctrl-C ends a wait for a busy post at once, and a lock left from before the machine restarted is taken over.
- On macOS and Linux, a post's or the ledger's lock whose process number now belongs to a program that started after the lock was taken is taken over, instead of staying busy.
- A post folder copied under a new name is refused, instead of writing over the original's post.json. `post list` and `--day`/`--in-stage` name it by its folder.
- An HTTP 4xx while FAL finishes an image no longer counts as a refusal, since FAL had already taken the job on. Each check on an image gives up after 30 s, and its download after 2 minutes, instead of hanging, and the FAL key is sent only to FAL.
- A paid call whose request never left the machine (a refused connection, a name that didn't resolve, a failed TLS handshake) frees its reservation instead of staying counted, and `source transcribe` stops at the first such file.
- Two `image generate` runs on one post no longer both pay for the same beat: one run at a time makes a post's images, and the second fails with `conflict`, naming the first.
- `--reroll` and `image import` no longer drop an image request already paid for: they refuse that beat with `conflict` and name the command that fetches it at no cost. A reroll stopped before sending, by a cap, a setting or Ctrl-C, keeps the old seed.

### Removed

- `source adopt`.
- The npm package: Node doesn't run TypeScript from inside `node_modules`.

### Fixed

- A total that lands exactly on a cap is no longer refused because of floating-point sums: the 50th $0.04 image under the $2 post cap goes through.
- A paid image or transcript is kept even when its ledger line can't be written.
- A ledger whose last line lost its newline, or that starts with a byte-order mark, stays readable.
- Negative caps, and calls priced below zero, are refused.
- `source transcribe` refuses a language code that isn't two letters, before sending the audio.
- `image generate --reroll` keeps the seeds when it stops on a missing key.
- Interrupting `image generate` while a request is being sent saves the request, so the next run resumes it instead of paying again.
- `capcut export` refuses a draft whose beats, images or captions changed after it was approved.
- A model's `options` in config.json can't change the image size, count, seed or prompt FAL is asked for, so the reservation always matches the bill.
- When you interrupt a command, it waits for ffmpeg to stop. No render keeps running and no temporary file is left.
- A command that spends nothing now refuses `--dry-run` instead of running for real.
- A config.json or brand.json that doesn't parse no longer stops every command. `doctor` reports it.
- `image generate` never sends a beat without a prompt, even on a reroll.
- When FAL ends a request, `image generate` frees its spending reservation and leaves no stale request behind.
- A missing transcript.json is transcribed again.
- Each `source download --url` gets its own folder.
- A failed import leaves no temporary file.
- A batch prints how many posts failed.
- Commands on a post that doesn't exist fail before taking its lock.
- With `--json`, a spending command run without `--yes` printed two objects. It now prints one, holding both the estimate and the error.
- Image estimates were about 24% low. FAL bills each image by whole megapixels, so a 1344×2400 image costs 4 MP: $0.012 with flux-schnell, $0.10 with flux-dev.

## [0.1.0] - 2026-11-06

### Added

- From audio to a draft you can review: import, word-timed transcription, beats, one AI image per beat, and an FFmpeg render with captions. Works on the CLI and as an MCP server.
- Story direction: each beat has a story moment that sets its length, motion and captions. An optional hook title.
- Review and hand-off: the evening review, a frame-exact CapCut export, finalize, publish and archive.
- Download and transcribe saved collections.
- Image import.
- Spending caps and `budget show`.
