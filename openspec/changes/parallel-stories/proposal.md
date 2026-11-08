# Parallel stories

## Why

The user works on several stories at once, often with one agent session per story. The pieces are partly there:

- each post has its own lock;
- the spending ledger has its own lock, so the caps hold when calls reserve at the same time;
- different posts can already run from different terminals.

What's missing:

- **Memory.** A draft render's ffmpeg peaks at about 4–6 GB (measured on the 66 s post, 23 beats), because every image is enlarged to 2496×4448 before the zoom and all of them sit in one ffmpeg run. Four renders at once can run a 16 GB machine out of memory.
- **Requests.** Image generation runs 3 requests at a time per post, so five posts make 15 at once against the same provider.
- **Batches.** Batch commands (`--day today`) run posts one after another, even when the machine could do more.
- **One post rendering twice.** `draft render` takes the post's lock only to save its result at the end. Two runs on one post can therefore write the same temporary files at once, for example when an agent retries a call that timed out.

## What Changes

- **Heavy commands hold the post's lock for the whole run.** `draft render`, `capcut export` and `clip import` take the post's lock first, then a render slot, and keep both until they finish. A second run on the same post waits. Over MCP, where clients give up after a while, a run that would wait longer than a set time returns `conflict` and names the holder, instead of hanging.
- **Render slots, per machine.** Each run of `draft render`, `capcut export` (including its full-length `draft-clean.mp4` and text overlay) and `clip import` (converting video) holds one slot for the whole command, never two:
  - `render.slots` sets how many. By default it's one per 8 GB of memory, and at least one. The memory is the container's limit when there is one, not the host's;
  - a command that finds no free slot waits, and says which posts and commands hold the slots;
  - Ctrl-C while waiting exits 130, holding nothing;
  - slots live in the machine's own cache folder, not in the data folder, because the data folder may be synced between machines (attempt-history). Each slot records its process and host. A slot whose process no longer runs on this host is taken over.

  `carousel render` and `preview` use Takumi, which needs about 150 MB, so they take no slot.
- **One request limit per provider.** Each provider has one limit on requests in flight across every post and process on the machine: `parallel` under that provider in `config.json`, 3 by default. All its jobs share it, so FAL images and FAL clips count together. A request slot also records its process and host, and is taken over the same way.
- **`--parallel N` for batch commands.** Commands that never ask the user anything can run on up to N posts at once (default 1). Each still takes its own locks and slots.
  - Results are reported in post order, and `--json` keeps today's shape.
  - Log lines start with the post's slug.
  - Ctrl-C stops every running post and reports the ones that finished.
- **Shared files written safely.** Anything several posts share in the data folder, like font downloads (see brand-look), is written to a temporary file and renamed, under a lock.
- **Less memory per draft, in the same single ffmpeg run.** Measure ffmpeg's peak for drafts of 30, 60 and 90 s, and with 10, 25 and 40 beats, with and without video clips. Then enlarge each image only as much as its zoom needs. Splitting the draft into several runs is out, because the text layer and the one-encode rule need a single run. Motion and frame counts must stay exactly as they are.
- **One agent per story.** The make-shorts skill says to run one agent session per story, each naming its post.

Not part of this change: spreading work over several machines, a background service that queues jobs, and new spending rules (concurrent reservations are already covered).
