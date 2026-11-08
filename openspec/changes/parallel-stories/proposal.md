# Parallel stories

## Why

The user works on several stories at once, often with one agent session per story. The pieces are partly there:

- each post has its own lock;
- the spending ledger has its own lock, so the caps hold when calls reserve at the same time;
- different posts can already run from different terminals.

What's missing is a limit across the whole machine:

- A draft render's ffmpeg peaks at about 4–6 GB (measured on the 66 s post, 23 beats), because every image is enlarged to 2496×4448 before the zoom and all of them sit in one ffmpeg run. Four renders at once can run a 16 GB machine out of memory.
- Image generation runs 3 requests at a time per post, so five posts make 15 at once against the same provider.
- Batch commands (`--day today`) run posts one after another, even when the machine could do more.

## What Changes

- **Render slots.** Heavy work (`draft render`, the CapCut export's clips, `carousel render`) takes a slot before it starts:
  - `render.slots` sets how many, by default one per 8 GB of memory and at least one;
  - a command that finds no free slot waits and says what's holding them, instead of failing;
  - Ctrl-C while waiting exits 130 with nothing left behind;
  - a slot held by a process that no longer runs is taken over, like a post's lock.
- **A limit per provider across the machine.** `image.parallel` (default 3) and the same for every paid job cap requests in flight across all posts, not per post.
- **`--parallel N` for batch commands.** Commands run on several posts can run up to N at once (default 1). Each still takes its own slots. Results are reported in post order, and `--json` keeps today's shape.
- **Shared files written safely.** Anything several posts share in the data folder, like font downloads (see brand-look), is written to a temporary file and renamed, under a lock.
- **Less memory per draft.** Measure ffmpeg's peak for drafts of 30, 60 and 90 s first. Then make memory stop growing with the number of beats, for example by enlarging each image only as much as its zoom needs, or by rendering beats in groups and joining them without encoding again. The motion and frame counts must stay exactly as they are.
- **One agent per story.** The make-shorts skill says to run one agent session per story, each naming its post. The post's lock already stops two sessions changing one post.

Not part of this change: spreading work over several machines, a background service that queues jobs, and new spending rules (concurrent reservations are already covered).
