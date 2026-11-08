# Tasks

## 1. Locks and slots

- [ ] 1.1 `draft render`, `capcut export` and `clip import` hold the post's lock for the whole run, then one render slot
- [ ] 1.2 Over MCP, return `conflict` naming the holder after a set wait instead of hanging
- [ ] 1.3 Render slots in the machine's cache folder, recording process and host; `render.slots` defaulting from memory (the container's limit when there is one)
- [ ] 1.4 Wait for a free slot, saying who holds them; Ctrl-C while waiting; take over a slot whose process is gone on this host
- [ ] 1.5 One request limit per provider (`parallel`, default 3), shared by all its jobs, recording process and host

## 2. Batch commands

- [ ] 2.1 `--parallel N` for commands that never ask the user; results in post order; the same `--json` shape
- [ ] 2.2 Log lines start with the post's slug; Ctrl-C stops all and reports the finished ones
- [ ] 2.3 Test: five posts, `image generate --parallel 5`, near the daily cap; the cap holds and no more than 3 FAL requests are in flight

## 3. Memory

- [ ] 3.1 Measure ffmpeg's peak for drafts of 30, 60 and 90 s; with 10, 25 and 40 beats; with and without clips
- [ ] 3.2 Enlarge each image only as much as its zoom needs, in the same single run; motion and frame counts identical
- [ ] 3.3 Update the default for `render.slots` from 3.1 and 3.2

## 4. Shared files and agents

- [ ] 4.1 Shared files in the data folder written to a temporary file and renamed, under a lock
- [ ] 4.2 The make-shorts skill: one agent session per story
