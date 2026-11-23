## ADDED Requirements

### Requirement: A post that can't be read SHALL NOT hide the others

`post list` SHALL list every post it can read and name each post it can't, with its error and fix. A batch by `--day` SHALL report a post it can't read as that post's failure; a batch by `--in-stage` SHALL leave it out and name it on stderr. The fix SHALL say to fix or undo the hand edit, or to move the post's folder out of `posts/mine`, and SHALL NOT refer to fields named elsewhere when none are.

#### Scenario: One damaged post

- **WHEN** one post's post.json isn't JSON and `post list --json` runs
- **THEN** it succeeds and lists the other posts
- **AND** it names the damaged post with its error and fix

#### Scenario: A batch by day

- **WHEN** `draft render --day today` runs and one of today's posts can't be read
- **THEN** the other posts are rendered
- **AND** the damaged post's result is its error

#### Scenario: Not JSON at all

- **WHEN** a post's post.json holds text that isn't JSON
- **THEN** the fix says to restore the file or move the post's folder out of `posts/mine`
- **AND** it doesn't refer to fields named above
