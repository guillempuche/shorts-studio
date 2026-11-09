# Tasks

- [x] 1.1 Each `SHORTS_*` variable names one setting; a bad one is left out; valid ones apply when `config.json` isn't valid; numbers written as text are read; `models` from `config.json` only
- [x] 1.2 `--json` prints one error object for a command called wrong (every form of `--json`), a group given no command, and an unexpected failure, whose trace goes to stderr
- [x] 1.3 `post.json` is written only in the folder it was read from while its `slug` names it; selection and `post list` name posts by folder
- [x] 1.4 Locks: one try at a time, Ctrl-C ends a wait at once, an unreadable lock path fails with a fix, a lock from before the machine started is taken over
- [x] 1.5 A 4xx after FAL took the job doesn't free the reservation; checks give up after 30 s and downloads after 2 minutes; the key is sent only to FAL
- [x] 1.6 Tests for each, and docs: architecture, CHANGELOG
