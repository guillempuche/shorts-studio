## 1. Next steps on errors

- [ ] 1.1 Move the `NextStep` Schema to `packages/domain/src/next-step.ts`, and the step builders (`agentStep`, `userStep`, `cliOf`, `shellWord`) to `packages/usecases/src/steps.ts`; `operations/post.ts` and `source-download.ts` import them from there; verify `pnpm check-types` and the existing post and stage-walk tests pass unchanged
- [ ] 1.2 Give each reason an optional `nextSteps`, `fail` a fourth argument, `ShortsError` a `nextSteps` getter, and `ErrorReport` and `reportOf` the optional field, copied only when not empty; verify `errors.test.ts` cases for an error with steps and one without (no `nextSteps` key)
- [ ] 1.3 Check that the field reaches both surfaces; verify a `cli.test.ts` case where `post show --post nope --json` prints `error.nextSteps`, and an `mcp.test.ts` case on every version where `post_show` for a missing post returns it with `isError: true`
- [ ] 1.4 Document the field in `docs/architecture.md` (Errors, Agent interface) and `CHANGELOG.md` (Added), and say in make-shorts' "When something fails" that an error's `nextSteps` work like a result's; edit in `.agents/skills/`, then run `pnpm skills:sync`; verify `pnpm check-links`

## 2. Fixes an MCP agent can follow

- [ ] 2.1 Give `notFound` in `post-store.ts` a `post_show` step for each dated match (newest first, `or` after the first) and name them all in the fix, else a `post_list` step; verify `post-store.test.ts` cases with one, two and no dated matches
- [ ] 2.2 Make `requireUser` and `image generate`'s unapproved-script refusal carry the user's step, and `image generate`'s beats-without-prompts error carry `nextStepsOf(post)`; verify the script and image tests check the first step's `by` and `tool`
- [ ] 2.3 Make `requireKey`'s fix start "Ask the user to set …", keep the Keychain command inside it, say a Keychain key reaches a running MCP server and an environment one needs a restart, and add the user's step; verify an `audio.test.ts` case with no key: `missing-key`, a first step by `user` with no tool
- [ ] 2.4 Add steps to `settingsRefusal` (`config_check`, then the user's), `chooseModel` (`config_check`) and `config_check`'s failure (`config_show`), keeping each fix's text and "doctor (MCP: config_check)"; verify the ledger, models and config tests, and that the spend-budget "fix names doctor" test still passes
- [ ] 2.5 Make `source transcribe`'s missing-audio error the user's step (`source download --collection <name>`, CLI only, after filling urls.txt), and `script approve`'s no-script fix name `script set --post <slug> --text <script>`; verify the source-download and script tests
- [ ] 2.6 Add one sentence to `SERVER_INSTRUCTIONS` in `apps/mcp/src/mcp.ts`: fixes name CLI commands, `noun verb --some-flag` is the tool `noun_verb` with `someFlag`, an error's `nextSteps` give the tool, and a step by `user` is the user's; verify `mcp.test.ts` checks the instructions mention `nextSteps`; add the reworded fixes to `CHANGELOG.md` (Changed)

## 3. Inline scripts and beats

- [ ] 3.1 Add `p.json(schema, description)` to `operation.ts`: the Schema as the MCP field, and `Flag.String` with `Flag.withSchema(Schema.fromJsonString(schema))` on the CLI; check both against `node_modules/effect/dist/**/*.d.ts`; verify an `operation.test.ts` case that decodes the same list from the flag's JSON text and from the field, and a CLI case where bad JSON exits 2
- [ ] 3.2 Extract `closedStruct(fields)` from `toolInputSchema`, use it for `toolInputSchema` and for the beat item Schema (`BeatList`); verify `operation.test.ts` cases where an item with `promt` is refused with the fields it takes, and the existing unknown-field MCP test still passes
- [ ] 3.3 Add `inputFile(path, fix)` to `inputs.ts` (resolve, exists, is a file, errors name the full path) and use it in `script set`, `beat set --from`, `image import`, `source import` and `post finalize`; say in their parameter descriptions that a relative path is read from the folder shorts-studio runs in; verify tests where a relative missing file's error names its absolute path and a folder is refused
- [ ] 3.4 Give `script_set` an optional `text` and make `file` optional, requiring exactly one; verify `script.test.ts` cases: text saved to script.md, both forms refused with nothing saved, neither refused with both forms in the fix
- [ ] 3.5 Give `beat_set` an optional `beats` (`p.json(BeatList)`), requiring exactly one of `beats`, `from`, or `beat` with a field; verify a `beat.test.ts` (new, next to `beat.ts`) case per form and a case with two forms refused
- [ ] 3.6 Make `nextStepsOf` offer `script_set { post, text: "<script>" }` and `beat_set { post, beats: "<beats>" }` with a note naming the beats without a prompt and the item shape, and write `beat plan`'s no-audio fix and the `--from moments.json` fix in full with placeholders; verify the post tests for each spec scenario under "Next steps SHALL be callable with MCP alone", and that the stage walk still finds every `args` key among the tool's fields
- [ ] 3.7 Run `pnpm schemas`; document the inline forms in `docs/architecture.md` and `CHANGELOG.md`, and add `--beats` and `--text` beside the file forms in the story-direction and make-shorts skills, then `pnpm skills:sync`; verify `pnpm check-links` and no schema diff left over

## 4. Closed tool inputs

- [ ] 4.1 Annotate each tool with `Tool.Strict, true` in `apps/mcp/src/mcp.ts`; verify an `mcp.test.ts` case on every version that every tool's `inputSchema.additionalProperties` is `false`, and that `image_generate` with `dry_run` still fails naming `dry_run` and listing `dryRun`
- [ ] 4.2 Pass `onExcessProperty: "error"` to `toJsonSchemaDocument` for command inputs in `schema show`; verify a `schema.test.ts` case where `beat_set`'s input and each `beats` item say `additionalProperties: false`, while `schema show --name post` is unchanged
- [ ] 4.3 Say in `docs/architecture.md` (Agent interface) that inputs are published closed, and add it to `CHANGELOG.md`; verify `pnpm check-links`

## 5. Checks before saving

- [ ] 5.1 Make `beat set` refuse a blank prompt and a beat named twice, in all three forms, before taking the lock; verify `beat.test.ts` cases for `"   "` and a duplicate in `beats` and in a `--from` file, each leaving `post.json`'s revision unchanged
- [ ] 5.2 Add `minWords: 3` and `maxWords: 7` to `HOOK_LAYOUT` in `direction.ts`; make `script set` refuse an empty script and a hook outside them, and remove the hook on `--hook ""`; verify `script.test.ts` cases for each, and one where only the hook changes after approval: still approved, and `draftInputHash` differs
- [ ] 5.3 Make `parseBeatList` take only `^\d+$` parts, and `image generate` refuse beats not in the plan right after reading the post; verify a new `inputs.test.ts` and `image.test.ts` cases for `7` on two beats, `0x`, `1.5`, `-1`, each with nothing reserved, no seed changed and no request sent
- [ ] 5.4 Make `post create` refuse an empty name, a leading date that doesn't read back as itself, and a slug over 100 characters with both lengths in the message; drop the fixed date from `checkSlug`'s example; verify `post.test.ts` cases for `""`, 120 characters and `2026-13-45-x`, each making no folder
- [ ] 5.5 Make `post publish` refuse a URL that `URL.parse` rejects, or whose scheme isn't `http:` or `https:`, or that has no host; verify a `lifecycle.test.ts` case for `https://` recording nothing
- [ ] 5.6 Make `budget show --post` fail with `not-found` (with the suggestion) when the name has no ledger entry, isn't a post and isn't `saved/<collection>` with its folder, and list an existing post with no spending at $0; verify `budget.test.ts` cases for both
- [ ] 5.7 Add the inputs now refused to `CHANGELOG.md` as **BREAKING**, including `--from` files with keys `beat set` doesn't take; verify `pnpm check-links`

## 6. Imports checked by content

- [ ] 6.1 Make `image import` read the file's first 12 bytes and accept only JPEG, PNG or WebP, naming the copy by its content; verify `image-import.test.ts` cases: text named `.png` refused with the beat's image unchanged, and a PNG named `.jpg` saved as `.png`
- [ ] 6.2 Add `audioStreams(file)` and `peakDb(file)` to `MediaTools` in `ports.ts`, the fake in `src/test/fakes.ts`, and ffmpeg's in `providers/src/ffmpeg.ts`; verify `ffmpeg.test.ts` cases with a stand-in `run` (streams counted, an unreadable file gives none, `max_volume` parsed), and a new `ffmpeg.integration.test.ts` on a generated tone, silence and a video without sound (`pnpm test:integration`)
- [ ] 6.3 Make `source import` refuse a file ffprobe can't read, one with no audio stream, and audio whose peak is at or below −60 dBFS, naming the given file and removing the temporary one; verify a new `source.test.ts` with the fake: each refusal names the file, never `audio.tmp.m4a`, and leaves `post.json` as it was
- [ ] 6.4 Add the import checks to `CHANGELOG.md`, and the silence threshold to the Import section of `docs/architecture.md`; verify `pnpm check-links`

## 7. Posts that can't be read

- [ ] 7.1 Make `readPost` tell text that isn't JSON from bad fields, with the fixes and the user's step from design.md; verify `post-store.test.ts` cases for each, neither saying "named above"
- [ ] 7.2 Add `readPosts(ctx)` returning `{ posts, unreadable }`, and give `post_list` an optional `unreadable` listed last in text; verify a `post.test.ts` case with one damaged post among three, with and without `--stage`
- [ ] 7.3 Make `selectPosts` filter `--day` by folder name without reading, and leave unreadable posts out of `--in-stage` with a stderr line; verify `cli.test.ts` cases: a `--day` batch reports the damaged post's error and runs the rest, and an `--in-stage` batch names it on stderr
- [ ] 7.4 Add it to `CHANGELOG.md`; verify `pnpm check-links`

## 8. Batches

- [ ] 8.1 Make `selectPosts` refuse `--post` with `--day` or `--in-stage`, and a `--day` that doesn't read back as the same date; verify `cli.test.ts` cases for both, each exiting 2 and running nothing
- [ ] 8.2 Add `batchCode(codes)` and the fixes from design.md, naming the failed posts as `--post a,b`; verify `cli.test.ts` cases: all `needs-approval` exits 3, `over-budget` with `not-found` exits 4, two `provider` failures of three name both slugs
- [ ] 8.3 Present usage hints for `--stage` and `--in-stage` mixed up and `--post` given twice, in text and in `--json`'s fix; verify `cli.test.ts` cases for `post list --in-stage idea` and `draft render --post a --post b`
- [ ] 8.4 Update `docs/architecture.md` (a batch's code) and make-shorts' "When something fails" (a batch fails with its posts' code), then `pnpm skills:sync`; add the batch exit codes and the refused `--post` with `--day` to `CHANGELOG.md` as **BREAKING**; verify `pnpm check-links`

## 9. `--json` however the CLI is called

- [ ] 9.1 Present the `Version` event as one object, read `--json=<word>` as JSON unless it's a false word, and leave `GlobalFlag.Wizard` out of the built-ins with `--json` through `CliConfig.layer`; check each API in `node_modules/effect/dist/cli/*.d.ts`; verify `cli.test.ts` or `main.test.ts` cases for `--version --json`, `post list --json=maybe` (exit 2) and `post list --wizard --json` (exit 2, no prompt)
- [ ] 9.2 Add it to `CHANGELOG.md`; verify `pnpm check-links`

## 10. Collections

- [ ] 10.1 Make `source download --collection` refuse a urls.txt that isn't a file or holds no URL before running yt-dlp, and `--url` and `--post` each name the other when missing; verify `source-download.test.ts` cases with the fake downloader showing it was never called
- [ ] 10.2 Make yt-dlp's `errors` fall back to the last 5 stderr lines when none says `ERROR`, and a collection run that downloaded nothing new and failed fail with `provider` carrying them; verify a `yt-dlp.test.ts` case with a stand-in `run` whose stderr has no `ERROR` line, and a `source-download.test.ts` case
- [ ] 10.3 Give `source transcribe` optional `next`, `nextSteps` and `failures`, list a file it can't read in a dry run instead of failing, and add the count of files done to an `over-budget` stop; verify `source-download.test.ts` cases for the dry run's step, an unreadable file among three, a provider failure's fix in `failures`, and a cap after two of five
- [ ] 10.4 Print `Next:` at the end of the text dry runs of `audio transcribe` and `source transcribe`; verify render tests for both
- [ ] 10.5 Add it to `CHANGELOG.md`; verify `pnpm check-links`

## 11. Small things

- [ ] 11.1 Make `schema show` read `image generate` and `image-generate` as `image_generate`, and list `cliOnly`; verify `schema.test.ts` cases for both spellings and that `script_approve` is in `cliOnly`
- [ ] 11.2 Add a warning row to the FAL and Together `checks` when their address is overridden, naming `SHORTS_<P>_URL` and the address; verify provider tests with and without the variable, and a `config.test.ts` case where `config_check` still succeeds
- [ ] 11.3 Add both to `CHANGELOG.md`; verify `pnpm check-links`

## 12. Check

- [ ] 12.1 Run `pnpm check && pnpm check-types && pnpm test && pnpm check-links`, `pnpm schemas`, and `openspec validate --all --strict`; all pass with no schema diff left over
- [ ] 12.2 Walk a post over MCP only, on a fresh `mcp serve` driven by a small script kept in the scratchpad. Use a sandbox:
  - temporary `SHORTS_DATA_DIR` and `SHORTS_POSTS_DIR`;
  - `SHORTS_FAL_URL` and `SHORTS_TOGETHER_URL` at `http://127.0.0.1:9`;
  - `FAL_KEY` and `TOGETHER_API_KEY` set to fake values, and `USER` set to an account with no Keychain entries for the missing-key probe;
  - no real provider is ever reached.

  Check each of these:
  - every tool lists `additionalProperties: false`;
  - `post_create`, `source_import` of a generated tone (`kind: music`), `beat_plan`, then `beat_set { beats }` and `script_set { text, hook }` taken from `nextSteps`, end at `script approve` by `user` with no tool;
  - `audio_transcribe { dryRun: true }` reports its budget;
  - `image_generate` returns `needs-approval` with the user's step;
  - `post_show` with the slug without its date returns a `post_show` step;
  - with no key, `audio_transcribe` returns `missing-key` with the user's step.
- [ ] 12.3 In the same sandbox, run the CLI probe for each input check and record the code and exit of each:
  - `beat set --prompt "   "`, and a duplicate in `--beats`;
  - `script set --text ""`, and a nine-word `--hook`;
  - `image generate --beat 7|0x|1.5|-1 --dry-run`;
  - `image import` of text named `.png`;
  - `source import` of a folder, a text file, a video without sound, and silence;
  - `post create --post ""`, a 120-character name, and `2026-13-45-x`;
  - `post publish --url https://`, and `budget show --post nope`;
  - `--post a --day today`, and `--day 2026-13-45`;
  - `source download` with an empty urls.txt, and `--url` without `--post`;
  - `post list` with one damaged post.json;
  - `--version --json`, `--json=maybe`, and `--wizard --json`;
  - `post list --in-stage`, and `--post a --post b`;
  - `schema show --name "image generate"`.

  Each matches its spec scenario.
