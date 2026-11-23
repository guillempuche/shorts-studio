# Agent recovery

## Why

An audit on 2026-11-12 drove the CLI and a fresh `mcp serve` as an agent would, and broke each step on purpose. An agent with only MCP can't get a post to the user's approval: `script_set` and `beat_set` read files it can't write. When something fails, the error says what to do in CLI and shell terms and doesn't say whose step it is. Bad input is often taken silently: an empty prompt counts as set, `--beat 7` on a two-beat post does nothing, a text file named `.png` becomes a beat's image. One damaged `post.json` stops `post list` and every batch.

## What Changes

- **Errors carry their next steps.** The error object gains an optional `nextSteps`, in the shape results already use. So the step's MCP tool, its arguments and whether it's the user's travel with the error. A fix for a step only the user can take (an approval, an API key, a CLI-only download) says to ask the user. `fix` stays text. The MCP server's instructions say how CLI names map to tools.
- **Scripts and beats inline.** `script_set` takes the script as `text`. `beat_set` takes a `beats` list (JSON text on the CLI, `--beats`). Next steps use these forms, with placeholders the agent fills in. File paths are resolved like `source import` resolves them, and errors name the full path.
- **Tool inputs are published closed.** `tools/list` and `schema show` say `additionalProperties: false`, which the server already enforces.
- **Inputs are checked before they're used.** Among them:
  - `beat set`: blank prompts and beats named twice.
  - `script set`: an empty script, and a hook that isn't 3–7 words.
  - `image generate --beat`: values that aren't beats of the post.
  - `image import`: a file that isn't really an image.
  - `source import`: a folder, a file with no audio, silent audio.
  - `post create`: an empty name, a name too long, a date that doesn't exist.
  - Also `post publish` with a bare `https://`, `budget show --post` for a post that doesn't exist, and an empty `urls.txt`.
- **One damaged post doesn't hide the others.** `post list` lists the rest and names the broken one with a fix. A batch by day reports it as that post's failure.
- **Batches say what failed.** A batch fails with its posts' code, such as `needs-approval` or `over-budget`, not always `failed`. Its fix names the posts that failed. **BREAKING** for scripts that read a batch's exit code: it can now be 2, 3 or 4, not only 1. `--post` together with `--day` or `--in-stage` is refused, as is a day that doesn't exist. **BREAKING** for scripts that passed both.
- **Collections report what happened.** `source download` fails when nothing could be downloaded. `source transcribe` gains next steps and gives each failed file its fix. A file it can't read no longer stops its dry run.
- **Small things.**
  - A slug without its date that matches several posts lists them.
  - `--version`, `--wizard` and `--json=maybe` keep `--json`'s one object.
  - `schema show` takes `image generate` as well as `image_generate`, and marks the CLI-only names.
  - A `SHORTS_*_URL` override shows as a warning in `config show` and `doctor`.
  - A dry run's text ends with `Next:`.
  - Mixing up `--stage` and `--in-stage`, or giving `--post` twice, gets a hint.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agent-interface`: errors with next steps, inline scripts and beats, closed tool inputs, input checks, batches, collections, and `--json` for every call.
- `media-pipeline`: imported images and audio are checked by what they hold.
- `post-manifest`: a post that can't be read no longer hides the others.

## Impact

- `packages/domain`:
  - `errors.ts`: `nextSteps` on the reasons, `ErrorReport` and `reportOf`.
  - A new `next-step.ts`: the `NextStep` Schema, moved from `operations/post.ts`.
  - `direction.ts`: the hook's word limits.
- `packages/usecases`:
  - `operation.ts` (`p.json`), `inputs.ts` (a shared file check, a strict beat list), `post-store.ts`, and `ledger.ts` (only the steps on `settingsRefusal`).
  - Operations: `script`, `beat`, `image`, `image-import`, `source`, `source-download`, `post`, `lifecycle`, `budget`, `schema`, `config`.
  - `ports.ts`: `MediaTools` gains an audio probe.
- `packages/providers`: `ffmpeg.ts` (the audio probe), and a warning row for an overridden address in each paid provider.
- `apps/cli/src/cli.ts`, `main.ts`; `apps/mcp/src/mcp.ts` (`Tool.Strict`, the instructions).
- `docs/architecture.md`, `CHANGELOG.md`, and the make-shorts and story-direction skills.

Not part of this change:

- Money, interrupts, settings keys, the ledger and locks. That's spend-safety, including the wording of the over-budget, provider and settings fixes. It can put the same `nextSteps` on those errors.
- Next steps that follow a post's state (a stale transcript, an archived post, who acts after the draft). That's state-aware-steps.
- Letting started beats finish after a failure (parallel-stories 1.6). Batch log lines that start with the post's slug (parallel-stories 2.2).
- A structured `fix`, and bumping `outputVersion`: every new field is optional.
- Bad MCP arguments as the `{ code, message, fix }` object: Effect answers them per protocol version.
- `additionalProperties: false` in `schemas/config.schema.json` and `brand.schema.json`: unknown settings keys are spend-safety's.
- One name for `post list --stage` and the batch `--in-stage`: it would rename an MCP field. A hint covers it.
- Accepting `--post` twice, and checking an imported image's size or orientation.
