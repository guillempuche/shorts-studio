# Effect review fixes

## Why

A review of how the code uses Effect found ways the caps could go back to their defaults without warning, commands could crash or hang without a fix, and `--json` could print something other than one object. Each one was reproduced before it was fixed.

## What Changes

- **Settings.** Each `SHORTS_*` variable names exactly one setting, so `SHORTS_CAPTIONS_FONT_SIZE` no longer hides `captions.font` or the rest of `config.json`. A variable that isn't valid is left out and the rest still apply, also when `config.json` itself isn't valid. `models` are set in `config.json` only. A number or yes/no written as text in `config.json` is read as that value, as before.
- **One JSON object.** With `--json`, a command called wrong, a group of commands given no command, and a step that fails unexpectedly each print one error object with a fix. The trace of an unexpected failure goes to stderr.
- **post.json and locks.** A command writes `post.json` only in the folder it read it from, and only while the file's `slug` names that folder, so a copied folder can't change the original. A lock taken before the machine last started is taken over. A lock file that can't be read fails with a fix instead of making the command wait forever, and Ctrl-C ends a wait at once.
- **Providers.** An HTTP 4xx about a job the provider already took on no longer frees its reservation. Each check on an image gives up after 30 s and its download after 2 minutes. The FAL key is sent only to FAL.

Not part of this change: what `image generate` does after one beat fails (planned in parallel-stories), and per-value fallback for a `config.json` that isn't valid.
