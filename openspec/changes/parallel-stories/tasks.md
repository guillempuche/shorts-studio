# Tasks

## 1. Limits across the machine

- [ ] 1.1 Render slots as lock files in the data folder; `render.slots` with a default from the machine's memory
- [ ] 1.2 Wait for a free slot, saying who holds them; Ctrl-C while waiting; take over a dead process's slot
- [ ] 1.3 `draft render`, the CapCut export's clips and `carousel render` take a slot
- [ ] 1.4 A limit per provider across all posts: `image.parallel` (default 3), and the same for each paid job

## 2. Batch commands

- [ ] 2.1 `--parallel N` for commands run on several posts, results in post order, the same `--json` shape
- [ ] 2.2 Test: five posts, `image generate --parallel 5`, near the daily cap; the cap holds and no more than 3 requests are in flight

## 3. Memory

- [ ] 3.1 Measure ffmpeg's peak for drafts of 30, 60 and 90 s, and with 10, 25 and 40 beats
- [ ] 3.2 Make memory stop growing with the number of beats, keeping motion and frame counts identical
- [ ] 3.3 Update the default for `render.slots` from 3.1 and 3.2

## 4. Shared files and agents

- [ ] 4.1 Shared files in the data folder written to a temporary file and renamed, under a lock
- [ ] 4.2 The make-shorts skill: one agent session per story
