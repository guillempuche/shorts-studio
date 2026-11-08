# Review page

## Why

To review a draft today, the user opens `draft.mp4` in a player, works out which beat is on screen from the times in `post show`, and types beat numbers into `post review`. Players like VLC or QuickTime don't notice when the agent renders again, so the user reopens files by hand. With several stories a day, this is the slowest part of the loop, and it's the part only the user can do.

## What Changes

- **`post watch`** serves a review page on this machine. Select posts with `--post`, `--day today` or `--in-stage draft`. It's CLI-only and, like approvals, needs an interactive terminal, so an agent's shell can't start it. It opens in any browser, including the Claude app's built-in one next to the chat. For each post the page shows:
  - the draft, with the current beat number and caption shown above it as it plays, worked out from the beat times the draft was rendered with, so no extra render is needed;
  - a strip of beats (agent-previews' sheet), the carousel slides of each platform in order, and the cover;
  - the agent's latest check results.
- **It updates itself.** When a draft, image, slide or check changes, the page refreshes that part. A new draft reloads at the same moment it was paused on, and its address includes the file's hash, so the browser never shows the old one.
- **Notes tied to a moment.** Pausing and pressing N (or "note here") saves a note. The note records:
  - its time and frame (`floor(t·30)`, the frame on screen when paused);
  - the beat at that frame, using the beat times the draft was rendered with, not today's beats;
  - the draft's hash.

  The beat number shows while typing, so the user sees where the note lands. `post review --note-at "0:12 too dark"` does the same from the terminal.
- **Notes on slides** are saved per platform and slide, and wait for `carousel review` (see carousel), not `post review`.
- **The decision stays in the terminal.** The page can't approve, fix or reject. It shows the command to run.
  - `post review` prints the waiting notes before it records anything, so the user sees every note that goes in, including any not typed by them.
  - It takes in the notes taken on the current draft.
  - Notes taken on an older draft are kept in the record but marked as being about an earlier draft, so the agent doesn't read them as being about this one.
- **The draft records its beat times** (in frames), so notes, the page and the strip all use what was actually on screen, even after the beats are cut again.
- **Safe by default:**
  - it listens only on 127.0.0.1, on a free port, with a token in the address;
  - it rejects requests whose `Host` isn't that address;
  - it serves only the selected posts' files;
  - it writes nothing but notes, under the post's lock.

This change builds on agent-previews for the strip of beats.

Not part of this change:
- opening the page from a phone or another device;
- spoken notes (they can reuse `audio transcribe` later);
- approving from the page.
