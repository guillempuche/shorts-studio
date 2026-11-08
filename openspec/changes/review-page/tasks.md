# Tasks

## 1. Server

- [ ] 1.1 `post watch` (CLI-only, interactive terminal): 127.0.0.1, a free port, a token, `Host` check, selected posts only
- [ ] 1.2 Serve drafts with range requests, so browsers can seek; file hashes in addresses
- [ ] 1.3 Push changes to the page when `post.json`'s revision or a file changes

## 2. Page

- [ ] 2.1 Draft player with the current beat number and caption above it, from the draft's recorded beat times
- [ ] 2.2 Beat strip (agent-previews' sheet), carousel slides per platform, cover, and check results
- [ ] 2.3 Reload a new draft at the same moment

## 3. Notes

- [ ] 3.1 The draft records its beat times in frames
- [ ] 3.2 Notes at a moment: `floor(t·30)`, the beat from the draft's beat times, the draft's hash; saved under the post's lock
- [ ] 3.3 Slide notes per platform, waiting for `carousel review`
- [ ] 3.4 `post review --note-at`; `post review` prints the waiting notes first, takes in the current draft's, and marks older ones
- [ ] 3.5 Show the command to run on the page; no way to decide from it
- [ ] 3.6 Docs: reviewing in the Claude app's browser and in any other browser
