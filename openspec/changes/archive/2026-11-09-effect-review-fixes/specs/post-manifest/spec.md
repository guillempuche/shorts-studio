## MODIFIED Requirements

### Requirement: post.json SHALL be written only by commands, safely

A command SHALL change `post.json` only while it holds that post's lock, in the folder it read it from, and only while the file's `slug` names that folder. It SHALL read the file again first, add 1 to `revision`, write a temporary file and rename it over `post.json`. A lock whose process no longer runs, or taken before the machine last started, SHALL be taken over. Ctrl-C SHALL end a wait for a lock at once.

#### Scenario: Two commands on one post

- **WHEN** a command holds a post's lock and another command asks for it
- **THEN** the second command waits
- **AND** after the wait, it names the holder and the holder's command

#### Scenario: A lock left by a crash

- **WHEN** the lock file names a process that isn't running
- **THEN** the next command takes the lock

#### Scenario: A copied post folder

- **WHEN** a post's folder is copied under another name and a command changes the copy
- **THEN** it refuses, naming the `slug` to set
- **AND** the original's `post.json` is unchanged
- **AND** `post list` names the copy by its folder

#### Scenario: A lock that can't be read

- **WHEN** a folder sits where a post's lock file goes
- **THEN** the command fails at once with a fix naming the lock file
