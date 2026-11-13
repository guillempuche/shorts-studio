## Context

The findings come from the 2026-11-12 recovery audit, which drove the CLI and a fresh `mcp serve` in a scratch data folder. Line numbers are as of fe43a4723. What the code does today:

- **Errors.** `ShortsError` (`packages/domain/src/errors.ts`) carries a `reason` with `message` and `fix`, and nothing else. `ErrorReport`, which `--json` prints and an MCP tool returns, is `{ code, message, fix }`.
- **Next steps.** `NextStep` and its builders (`agentStep`, `userStep`, `cliOf`) live in `operations/post.ts`. `post-store.ts` can't import that file, because `post.ts` imports `post-store.ts`.
- **Files an MCP agent can't write.**
  - `script_set` takes only `file`, checked with `existsSync(input.file)` and not resolved (`script.ts:36`).
  - `beat_set --from` is read the same way (`beat.ts:155`).
  - `nextStepsOf` offers `script_set { file: "script.md" }`, which isn't a placeholder, and `beat_set { from: "<beats.json>" }` with a note that points at a skill (`post.ts:118,127-139`).
  - `source import`, `image import` and `post finalize` already `resolve` their paths.
- **Tool inputs.** `toolInputSchema` (`operation.ts:179`) wraps the fields in a `StructWithRest` whose rest record refuses any other key with "This tool doesn't take this field. It takes: …". Effect publishes that as `additionalProperties: true`.
- **Bad input taken silently** (all reproduced on the CLI):
  - `beat set` trims a prompt and saves `""` as set (`beat.ts:245`). A beat named twice: the last one wins.
  - `script set` saves an empty file and any hook.
  - `parseBeatList` uses `parseInt` (`inputs.ts:77`), so `0x` is 0 and `1.5` is 1. `image generate` drops the beats the plan doesn't have (`image.ts:309`).
  - `image import` checks only the extension (`image-import.ts:36`).
  - `source import` hands any path to ffmpeg, so a bad file's error names `audio.tmp.m4a` (`source.ts:42-60`).
  - `post create --post ""` makes `2026-11-12-`.
  - `post publish` takes `https://`.
  - `budget show --post nope` returns `posts: []`.
- **Reading posts.** `post list` and the batch selection read every `post.json` with `Effect.forEach` (`post.ts:303-310`, `cli.ts:164`), so one that fails to decode fails them all. The fix says "Fix the fields named above", even when the file isn't JSON (`post-store.ts:81`).
- **Batches.** `selectPosts` ignores `--post` when `--day` or `--in-stage` is given, and checks the day only against `\d{4}-\d{2}-\d{2}`. A batch with failures always fails with `failed`, and its fix says "run the command again to retry them" (`cli.ts:262-270`).
- **The CLI's own flags.** The audit's probes found:
  - `--version --json` prints text, and `--wizard --json` starts the interactive wizard.
  - `--json=maybe` prints help, because `jsonRequested` reads only the true words.
  - `--post a --post b` fails with "Invalid value for flag --post: "2 occurrences"".
  - `--stage` on a batch command fails with "Unrecognized flag", without naming `--in-stage`.

Constraints from the other open changes are under "Coordination".

## Goals / Non-Goals

**Goals:**

- An agent with only the MCP tools can take a post from `post_create` to the step the user approves.
- Every error whose fix names a step gives that step as data, with its owner.
- Input that can't be right fails before anything is saved, reserved or sent, and names what's wrong.

**Non-Goals:**

- Changing what an error's code means, or how the CLI maps codes to exit codes.
- Making `fix` structured, or writing it differently per surface: the CLI and MCP return the same error object.
- The fixes for money, settings and the ledger. spend-safety owns them.

## Decisions

The user confirmed every decision below, as recommended, on 2026-11-13.

### Next steps on the error

The `NextStep` Schema moves to `packages/domain/src/next-step.ts`, unchanged. Each reason's fields become `{ message, fix, nextSteps?: NextStep[] }`. Then:

- `fail(code, message, fix, nextSteps?)` takes the steps.
- `ShortsError.nextSteps` reads them from its reason.
- `ErrorReport` gains an optional `nextSteps`, and `reportOf` copies it only when it isn't empty.

So the CLI's `--json`, the batch `results` and the MCP tool failure all carry it, with no other change.

The builders move to `packages/usecases/src/steps.ts`. It imports only `operation.ts` (for `commandPath`, `flagName`) and the domain, so `post-store.ts`, `inputs.ts` and `ledger.ts` can build steps without an import loop. `operations/post.ts` imports them from there.

Errors that get steps in this change: every `fail` in `packages/usecases` whose fix names a shorts-studio command or a step that's the user's.

| Where                                                                    | Steps                                                       |
| ------------------------------------------------------------------------ | ----------------------------------------------------------- |
| `post-store.ts` not-found                                                | `post_show` for each dated match, else `post_list`          |
| `post-store.ts`, a post that can't be read                               | the user's: fix or undo the edit, or move the folder        |
| `inputs.ts` `requireUser`                                                | the user's, with the command                                |
| `inputs.ts` `requireKey`                                                 | the user's: set the key                                     |
| `ledger.ts` `settingsRefusal`                                            | `config_check`, then the user's: fix the file it names      |
| `models.ts` `chooseModel`                                                | `config_check`                                              |
| `config_check`'s failure                                                 | `config_show`                                               |
| `image generate`: an unapproved script, beats without prompts            | `script approve` (the user's); `nextStepsOf(post)`          |
| `beat plan`: no audio, no transcript, no moments                         | `source_import`, `audio_transcribe`, `beat_set`             |
| `beat set`, `script set`: nothing given; `script approve` with no script | the inline form, with placeholders                          |
| `source transcribe`: no audio in the collection                          | the user's: `source download --collection <name>`, CLI only |

How the fixes read:

- A fix names an operation as `noun verb` (the tool is `noun_verb`).
- `doctor` stays in the fixes that name it, as "doctor (MCP: config_check)", because spend-budget's scenario checks for the word.
- A step that's the user's has a fix that starts "Ask the user to …". A shell command, such as the Keychain's `security`, appears only inside such a fix, never as an agent's step.
- `requireKey`'s fix says a key put in the Keychain reaches a running MCP server on its next call, while one set in the environment needs a restart. `secret` reads the Keychain on each call (`node.ts:262`).

The MCP server's instructions gain one sentence: fixes name CLI commands, `noun verb --some-flag` is the tool `noun_verb` with `someFlag`, and an error's `nextSteps` give the tool, while a step by `user` is for the user.

Alternatives:

- Write both the CLI command and the tool name in every fix. Rejected: the agent would still parse prose to tell its own step from the user's.
- Render `fix` per surface. Rejected: the CLI and MCP must return the same error object.
- An `owner` field on the error. Rejected: `by` on each step already says it, and one error can hold an agent's step and then a user's.

### Inline scripts and beats from one declaration

`p.json(schema, description)` joins `p.*` in `operation.ts`:

- Over MCP, its field is `schema` itself.
- On the CLI, its flag is `Flag.String(name).pipe(Flag.withSchema(Schema.fromJsonString(schema)))`. `Flag.withSchema` is in `cli/Flag.d.ts`. `Param.js:1405-1416` turns a failed decode into `CliError.InvalidValue`, which is a usage error, exit 2.

Then:

- `script_set` gains `text: p.optional(p.string(…))`, and `file` becomes optional. Exactly one is required, else `usage` with both forms in the fix.
- `beat_set` gains `beats: p.optional(p.json(BeatList, …))`. `BeatList` is a list of `{ beat, prompt?, moment?, motion? }`, the same items `--from` reads. Exactly one of `beats`, `from`, or `beat` with a field is required.
- A shared `inputFile(path, fix)` in `inputs.ts` resolves a path, checks it's a file, and names the full path when it isn't. `script set --file`, `beat set --from`, `image import`, `source import` and `post finalize` use it.
- Their parameter descriptions say a relative path is read from the folder shorts-studio runs in, which for MCP is where the server started.

`nextStepsOf` offers:

- `script_set { post, text: "<script>" }`.
- `beat_set { post, beats: "<beats>" }`, with a note that names the beats without a prompt and the item shape, `[{"beat": 0, "moment": "hook", "prompt": "…"}, …]`, instead of a skill.

`NextStep.args` stays strings and booleans: a placeholder is a string, and `fill` says the agent replaces it, here with text or a list. Fixes that meant a file read `--file <script.md>`. `beat plan`'s no-audio fix is written out in full, with placeholders.

Alternatives:

- `beats` as a JSON string on both surfaces. Rejected: MCP clients build arrays, and a string field can't publish what each item holds.
- `from` taking either a path or JSON text. Rejected: a path that looks like JSON is ambiguous, and so is the error.
- A tool that writes a scratch file for the agent. Rejected: a second step, and files outside the posts folder.

### Closed tool inputs, kept with our message

Each tool gets `.annotate(Tool.Strict, true)` in `apps/mcp/src/mcp.ts`. In effect 4.1.2:

- `Tool.Strict` is declared at `ai/Tool.d.ts:1455-1501`.
- `McpServer.js:1984-1992` then decodes arguments with `onExcessProperty: "error"`.
- `McpServer.js:2084-2099` publishes the input with `toJsonSchemaDocument(…, { onExcessProperty: "error" })`.

A spike on 2026-11-12 ran the real operations through `McpTest` with the annotation, keeping `toolInputSchema` as it is:

| Check                               | 2026-07-28                                                                                                   | 2025-06-18                   |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------- |
| every tool's `additionalProperties` | `false`                                                                                                      | `false`                      |
| `image_generate { post, dry_run }`  | `isError`, "This tool doesn't take this field. It takes: post, beat, reroll, model, dryRun" at `["dry_run"]` | JSON-RPC `-32602`, same text |
| `post_show { post: "nope" }`        | our `{ code, message, fix }`                                                                                 | the same                     |

The `StructWithRest` stays, because without it the message is Effect's "Expected no excess property", which doesn't list the fields. The published schema also gains a permissive `propertyNames` (`anyOf` of the field names and any string), which accepts every name and changes nothing for a client.

`schema show` passes `onExcessProperty: "error"` to `toJsonSchemaDocument` for command inputs only. The post, config and brand file schemas stay as they are.

The rest record moves into a `closedStruct(fields)` helper, and `BeatList`'s items use it too. So `--beats` and `--from` refuse an unknown key with the same message, on the CLI as over MCP. A strict decode inside an array reports Effect's text instead: the spike's `beats: [{ beat: 0, extra: 1 }]` named `["beats"][0]["extra"]`.

Alternatives:

- A Struct-level JSON Schema override annotation. Effect 4.1.2 has none: `toJsonSchema` exists only on filters and declarations (`Schema.d.ts:13235`).
- Only `Tool.Strict`, dropping the rest record. Rejected: the message would stop naming the fields the tool takes.

### Checks before saving

- `beat set` refuses a blank prompt and a beat named twice, in all three forms, with `usage` naming the beats, before it takes the post's lock.
- `script set` refuses an empty script, after trimming. The hook must be `HOOK_LAYOUT.minWords` to `maxWords` words (3 and 7, added to `direction.ts`, which holds every caption number). An empty `--hook ""` removes it, since the renderer already skips a blank hook.
- The hook stays out of `approvalOf`. The approval guards spending on images, and the hook changes no image. `draftInputHash` covers the hook (`draft.ts:33-42`), so a new hook makes the draft out of date, and the user reviews it again.

Alternatives:

- The hook joins the approval. Rejected: a title edit would block images that don't depend on it, and the draft review already catches it.
- Warn about the hook instead of refusing it. Rejected: a warning goes to stderr, which an MCP agent doesn't see.

### Beat lists

- `parseBeatList` takes only parts that match `^\d+$`.
- `image generate` checks each against the plan right after reading the post, before the settings, keys and `--reroll` steps, and fails with `usage` naming the bad values and the plan's range.

Alternative: skip the beats the plan doesn't have, with a warning. Rejected: a run that does nothing and exits 0 is the bug.

### Imports checked by content

`image import` reads the first 12 bytes:

- JPEG starts with `FF D8 FF`.
- PNG starts with `89 50 4E 47 0D 0A 1A 0A`.
- WebP has `RIFF` at bytes 0–3 and `WEBP` at 8–11.

Anything else is `usage`. The copy's extension comes from the content, not the name.

`source import` checks, in order:

1. The path is a file (`inputFile`).
2. `MediaTools.audioStreams(file)` reports the audio streams ffprobe finds (`-select_streams a`), or nothing when ffprobe can't read the file.
3. After the conversion, `MediaTools.peakDb(tmp)` reads ffmpeg's `volumedetect`. A peak at or below −60 dBFS counts as silent: speech and music peak far above it, and digital silence reads −91. The number sits beside the import code.

Each refusal names the given file, removes the temporary one, and leaves `post.json` as it was. The fake `MediaTools` gains both methods; ffmpeg's are covered by an integration test.

Alternatives:

- ffprobe for images. Rejected: it needs ffmpeg for a check the header answers.
- Catch silence after transcription, at 0 words. Rejected: by then it's paid.
- Warn on silence. Rejected: nothing useful comes from a silent post.

### Posts that can't be read

`readPost` tries `JSON.parse` first. Then:

- Text that isn't JSON fails with the parse error. Its fix says to restore the file, from a backup or version control, or move the post's folder out of `<posts>/mine`.
- A Schema failure keeps naming the fields in its message, and its fix says "the fields named in the message".
- Both are the user's steps.

A new `readPosts(ctx)` returns `{ posts, unreadable }`, and its users are:

- `post_list`, whose output gains an optional `unreadable: [{ slug, error }]`, listed last in text, whatever `--stage` is.
- `selectPosts`. With `--day` it filters folder names without reading, so the operation's own `readPost` reports a broken post as that post's failure. With `--in-stage` it reads, leaves out what it can't, and names each on stderr.

Alternatives:

- An `unreadable` stage. Rejected: `Stage` is a post's stage, published in the schemas.
- Fail as today. Rejected: that's the bug.

### Batches

`selectPosts` refuses `--post` together with `--day` or `--in-stage`, with `usage`. It accepts a `--day` only when it reads back as the same date: `2026-13-45` doesn't.

A batch with failed posts fails with `batchCode(codes)`:

- the code they all share;
- else `over-budget` when any post has it;
- else `needs-approval` when any has it;
- else `failed`.

Its message counts the failures. Its fix depends on the code:

- `over-budget` or `needs-approval`: the named posts wait on the user, and each one's own fix says what to ask.
- Otherwise: follow each post's fix, then run the same command on just those posts, `<command> --post a,b`, with the same flags.

The `needs-confirmation` of a missing `--yes` keeps its precedence (`cli.ts:263`); when it's raised is spend-safety's.

The usage hints come from one presenter for text and JSON. It reads `CliError.UnrecognizedOption.option` and `CliError.InvalidValue.option` (`cli/CliError.d.ts:172-235, 416-435`):

- `--stage` on a batch command names `--in-stage`.
- `--in-stage` on `post list` names `--stage`.
- `--post` given twice names `--post a,b`.

Alternatives:

- Take the posts that match both `--post` and `--day`. Rejected: nobody asked for it, and refusing can be loosened later. Ignoring one silently is the bug.
- Always `failed`, with each post's code in `results`. Rejected: an exit code of 1 hides that the posts wait on the user.
- Use the highest exit code. Rejected: a `usage` in one post (2) would outrank everything, yet the batch wasn't called wrong.

### `--json` however the CLI is called

- `cliOutput` presents the `Version` event (`cli/CliOutput.d.ts:307`) as `{ ok: true, outputVersion, command: "version", result: { version } }`.
- `jsonRequested` treats `--json=<word>` as JSON unless the word is one of the false words, so the usage error comes out as JSON.
- With `--json`, the CLI leaves `GlobalFlag.Wizard` out of the built-ins through `CliConfig.layer({ builtIns })` (`cli/CliConfig.d.ts:42,81`). Then `--wizard` is an unknown flag, a usage error.

### Collections

`source download --collection` checks that urls.txt is a file with at least one line that isn't blank or a `#` comment, before running yt-dlp. When yt-dlp fails:

- Its `errors` fall back to the last 5 lines of stderr when no line says `ERROR` (`yt-dlp.ts:67-70`).
- A run that downloaded nothing new fails with `provider`, like a single URL that failed. A run that downloaded some stays a result with `failed: true`.
- `--url` and `--post` each need the other, with `usage` naming the missing one.

`source transcribe`'s output gains optional `next`, `nextSteps`, and `failures: [{ file, error }]`. `failed` stays as text lines, so readers don't break.

- A dry run's next step comes from `nextAfterDryRun`.
- A run with failed files offers running it again.
- In a dry run, a file whose duration can't be read is listed in `failures` instead of failing the run.
- A cap reached part-way fails with `over-budget`, with "Transcribed N of M files before the cap; they're kept." added to the message. The fix and steps stay those of the ledger.

### Small things

- **Several dated matches:** `notFound` names them all, newest first, with one `post_show` step each, marked `or` after the first.
- **`schema show`:**
  - It reads `image generate` and `image-generate` as `image_generate`.
  - Its output gains `cliOnly`, the names that aren't MCP tools, marked "(CLI only)" in text.
- **Address overrides:** each paid provider's `checks` adds a warning row when `endpoints[provider]` is set, naming `SHORTS_<P>_URL` and the address. Warnings don't fail `doctor`.
- **`post publish`:** the URL must parse with `URL.parse`, have the scheme `http:` or `https:`, and have a host.
- **`budget show --post`:** a name with no ledger entry must be a post (through `readPost`'s check, which suggests one) or `saved/<collection>` with its folder. A post that exists shows $0.
- **Post names:** `post create` checks the name without its date:
  - it isn't empty;
  - a leading date reads back as itself;
  - the slug fits in 100 characters, with a message that gives both lengths.

  `checkSlug`'s example becomes `morning-routine`, with no date.
- **Text dry runs:** `audio transcribe` and `source transcribe` end with `Next:`.

### Coordination

- **spend-safety** edits the same code:
  - `settingsRefusal`'s text, `requireKey`'s restart advice, `nextAfterDryRun`, `image.ts`, and the CLI's `--yes` request in `cli.ts`.
  - This change adds only steps to `settingsRefusal` and `requireKey`, the `--beat` check to `image.ts`, and the batch code to `cli.ts`.
  - Whichever lands second keeps both. The spend-budget scenario that checks for `doctor` keeps passing.
  - Its `closest(name, candidates)` helper, for unknown settings, is the one the usage hints use if they grow past the fixed pairs above.
- **state-aware-steps** rewrites `nextStepsOf`'s branches and `beat.ts`'s messages, adds a by-moment step before `beat_set`, and drops archived posts in `selectPosts`. This change only changes the args and note of the `script_set` and `beat_set` steps, and the selection checks. Its `withDraft()` fixture fix doesn't affect these tests. Once errors carry steps, its `stale` refusals can carry the post's.
- **parallel-stories:**
  - Its 2.2 starts batch log lines with the post's slug, which is why this change leaves them alone.
  - Its 1.6 lets started beats finish. The batch code here applies to whatever error a post ends with.
- **renderer-text-layers** modifies the setup-check requirement. This change adds steps to `config_check`'s failure and warning rows for overridden addresses, and leaves the fix text and the requirement alone.

## Risks / Trade-offs

- **A `--from` file with extra keys** that used to pass, such as rows copied from `beat plan`'s output, is now refused. → The message lists the keys it takes, and the CHANGELOG says so.
- **A hook of one or two words** is refused. → The fix says 3 to 7 words. The numbers live in `direction.ts`, so they're one edit away.
- **A real but very quiet recording** could read as silent. → −60 dBFS is far below any usable take, and the fix says to check the file's level.
- **A valid image with an unusual header** is refused. → The fix says to export it as JPEG, PNG or WebP.
- **Batch exit codes change** (**BREAKING** for scripts). → The CHANGELOG and make-shorts' "When something fails" say so in the same change.
- **The published `propertyNames` reads oddly.** → It accepts every name. A test pins `additionalProperties: false`, not the rest of the shape.
- **Several open changes edit `cli.ts` and `post.ts`.** → The batch code is one helper with its own tests, and the step changes are confined to two branches.

## Migration Plan

Nothing to migrate: `post.json` and the ledger don't change. New fields are optional, so `outputVersion` stays 1. The CHANGELOG marks the batch exit codes and the inputs now refused as **BREAKING**.
