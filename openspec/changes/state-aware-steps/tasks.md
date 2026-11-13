## 1. What outputs record

- [ ] 1.1 Add `transcript.audioHash`, `beats.sourceHash` and `image.prompt` as optional fields to the Post Schema in `packages/domain/src/post.ts`, each with a doc comment, and run `pnpm schemas`; verify a `post.test.ts` case decodes a post with and without them, and `git diff schemas/` adds only those three properties
- [ ] 1.2 End beats with the audio in `planBeats` (drop words that start at or after the end, cut a word's end back to it), keeping `PLANNER_VERSION` at 2; verify a `beats.test.ts` case for the scenario "A word that ends after the audio", and the existing beats tests pass unchanged
- [ ] 1.3 Create `packages/usecases/src/freshness.ts`: move `planInputHash`, `draftInputHash`, `captionStyle`, `imageInputHash` and `fullPrompt` into it unchanged (and point `beat.ts`, `draft.ts`, `capcut.ts` and `image.ts` at it), then add `freshnessOf(ctx, post)` with the rules for new and older posts in design.md; verify `freshness.test.ts` covers every value of each field, each rule for older posts, music, and the scenarios "New audio" and "A new image model" of "Later steps SHALL check outputs against the post's own inputs", and the image test "should keep an image made by an earlier version up to date" still passes
- [ ] 1.4 Write `transcript.audioHash` in `audio transcribe`, `beats.sourceHash` in both paths of `beat plan`, and `image.prompt` in `image generate`, also when it picks up a saved request; verify `audio.test.ts` ("What a transcript was made from"), a new `beat.test.ts` and `image.test.ts` each read the field back from `post.json`
- [ ] 1.5 Give `withDraft()` a transcript, and add `seedUpToDate(ctx, slug, fields)` in `packages/usecases/src/test/posts.ts`; verify a test where `freshnessOf` reads a post seeded from `withDraft()` this way as current in every field, and the existing suite still passes
- [ ] 1.6 Describe the three fields and the "post's own inputs" rule under "post.json" in `docs/architecture.md`; verify with `pnpm check-links`

## 2. Next steps from the post's state

- [ ] 2.1 Make `nextStepsOf(post, freshness)` pure with an `UP_TO_DATE` base. Make `nextOf(ctx, post)` and `nextStep(ctx, post)` Effects that read `freshnessOf`, and yield them in every operation that returns `next` or puts it in a fix: `audio`, `beat`, `capcut`, `draft`, `image`, `image-import`, `lifecycle`, `post`, `script`, `source`. Verify `pnpm check-types` passes, and the existing next-step tests pass with the scenario "A post with audio but no transcript" changed to the dry run
- [ ] 2.2 Order the steps for archived, final and posted posts, the transcript, the beats and the prompts as design.md lists them: music skips transcription, stale beats say how many prompts they drop, and the by-moment step is offered; verify one `post.test.ts` case each for "New audio after the beats", "Beats cut from an earlier transcript", "A music post", "Moments without prompts", "A published post" and "An archived post"
- [ ] 2.3 Add the image steps: the dry run names in `beat` only the beats that need work, a pending request or a missing file counts, and a missing imported image gets a note naming `image import`; verify cases for "A prompt changed after its image", "A request in flight", "An image file that's gone", and one where `config.json` names another image model and `post show` names `draft render`
- [ ] 2.4 Add the draft and stage steps: a stale draft before review, an approved draft that no longer matches the export, the needs-fix notes in front of the step that comes next, a rejected post as the user's call, and `capcut export`'s result starting at polishing; verify cases for "A draft out of date before its review", "An approved draft whose beats changed", "Fixes asked", "A rejected draft" and "After the CapCut export"
- [ ] 2.5 Extend the stage-walk test in `post.test.ts`: walk each stage's fixture again with each kind of out-of-date output in `Freshness`, keeping its checks (each tool is on the MCP surface, its `args` are that tool's fields, its `cli` is that operation's command, placeholders are in `fill`); verify it passes, and fails when a step names a tool that doesn't exist
- [ ] 2.6 Update the docs and skills:
  - "Agent interface" in `docs/architecture.md`: the steps follow what's out of date, and transcription is a dry run first;
  - make-shorts in `.agents/skills/`: step 3's dry run, step 10's notes as steps, step 11's rejected post as the user's call;
  - story-direction: a plain `beat plan` keeps a re-cut, and the by-moment step;
  - the CHANGELOG lines.

  Then run `pnpm skills:sync`; verify `pnpm check-links` passes and `.claude/skills/` matches `.agents/skills/`

## 3. Commands that refuse out-of-date parts

- [ ] 3.1 In `beat plan`: refuse with `stale` when the transcript was made from other audio, skip a current plan or re-cut, word the stale message as design.md says, and refuse `--by-moment` on stale beats; verify `beat.test.ts` cases for the three scenarios of "Beats SHALL be cut from the current transcript" and for `--by-moment` on stale beats, each refusal leaving `post.json`'s `revision` unchanged
- [ ] 3.2 In `draft render`: refuse with `not-found` when an image or its file is missing, and with `stale` when the transcript or beats are stale or an image is changed or pending, with the fixes in design.md; verify a new `draft.test.ts` with the three scenarios of "A draft SHALL be rendered only from up-to-date parts", each with no render recorded by the fake renderer, and one where `config.json` names another image model and the draft renders
- [ ] 3.3 In `image generate`'s plan, make a generated image whose file is gone `generate` with the beat's seed, and leave imported images as they are; verify an `image.test.ts` case for "An image file that's gone" (post-manifest) that sends beat 1 only
- [ ] 3.4 Make Together's no-words fix name `source import` with `--kind music`; verify a `together.test.ts` case against the local fake service for "An instrumental track imported as speech"
- [ ] 3.5 Reword `source.ts`'s header comment, which says new audio marks its outputs out of date, to say what checks it now; verify by reading the diff

## 4. After the draft

- [ ] 4.1 Add `refuseUnapproved(ctx, post, command)` in `operations/post.ts` with design.md's tables. Use it in `capcut export`, `post finalize` and `post publish`, and let `capcut export` run whenever the current review approves. Verify `capcut.test.ts` and `lifecycle.test.ts` cases for:
  - "Exporting before the review", "Exporting a draft that needs fixes", "Publishing a rejected draft";
  - "Exporting again after the final video";
  - "Publishing before approval", "Publishing an approved draft", "Finalizing a published post".
- [ ] 4.2 Make `post archive` keep and return the first `archivedAt`, with `next` and `nextSteps`, and print the current review in `post show`'s text output; verify cases for "Archiving twice" and "A review with notes"
- [ ] 4.3 Record the `needs-fix` code change as **BREAKING** in `CHANGELOG.md`, and say which code each review state gets under "After the draft" in `docs/architecture.md`; verify `pnpm check-links`

## 5. Archived posts

- [ ] 5.1 Add `refuseArchived` in `post-store.ts`, and call it in each operation design.md lists, before any reservation or write; verify a test that walks every operation with a required `post`, except `post_show` and `post_archive`, from a table of valid arguments. It fails when an operation is missing from the table, and checks `conflict`, an unchanged ledger and an unchanged `revision` ("Spending on an archived post")
- [ ] 5.2 Leave archived posts out of `selectPosts` in `apps/cli/src/cli.ts` unless `--in-stage archived` is given; verify a `cli.test.ts` case for "Today's posts with one archived" and one where `post show --in-stage archived` lists it ("Reading an archived post")
- [ ] 5.3 Say in `docs/architecture.md` and the make-shorts skill that an archived post no longer changes and can't be taken out of the archive, then run `pnpm skills:sync`; verify `pnpm check-links`

## 6. Check

- [ ] 6.1 Run `pnpm check && pnpm check-types && pnpm test && pnpm check-links`, `pnpm schemas`, and `openspec validate --all --strict`; all pass, with no schema diff left over
- [ ] 6.2 Add `packages/usecases/src/operations/loop.test.ts`, which walks one post through every stage with fake ports. It runs each agent step that `nextSteps` names. It stands in for the user's decisions with the test helpers (`approveAsIs`, a review seeded into `post.json`), never `script approve` or `post review`. The walk:
  - import, the transcription dry run, then the real run;
  - moments, the re-cut, prompts and the script;
  - approval, the images dry run and images, the render;
  - a fix review on beat 1, a new prompt, approval again, beat 1's image, the render;
  - an approve review, the export, finalizing, publishing and archiving.

  Verify each step moves the post to the stage the spec names, and that `image generate` on the archived post fails with `conflict`
- [ ] 6.3 In a scratch data and posts folder, run the real CLI and a fresh `mcp serve`, spending nothing and never running `script approve` or `post review`:
  - make a 6 s tone with ffmpeg, then `post create`, `source import --kind music`, and check `post show` names `beat plan`;
  - `beat plan`, `beat set --from moments.json`, and check `post show` names `beat plan --by-moment`;
  - import the tone into a second post with `--kind speech`, check `post show` names `audio transcribe --dry-run`, and run that dry run;
  - `post archive` the first post, and check `image generate --dry-run` on it fails with `conflict`, and `post_show` over MCP returns empty `nextSteps`.

  Verify each command's output matches

## Workflow follow-up

- Archive the change once it ships, and confirm `openspec validate --all --strict` still passes on the main specs.
