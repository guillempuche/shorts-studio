## ADDED Requirements

### Requirement: The evening check SHALL be the user's

`post review` SHALL be CLI-only and SHALL record the decision (approve, fix, reject), the user's notes and the beats chosen for animation in `post.json`, tied to the hash of the draft it was made on.

#### Scenario: An agent's tools

- **WHEN** an MCP client lists the tools
- **THEN** no tool records a review decision

#### Scenario: The draft is rendered again

- **WHEN** an approved draft is re-rendered
- **THEN** the post waits for a new review

### Requirement: Downloads SHALL stay on the CLI

`source download` SHALL be CLI-only, SHALL call the user's own yt-dlp, and SHALL use browser cookies only when `download.cookiesFromBrowser` is set in config.json.

#### Scenario: Re-running a collection

- **WHEN** a collection is downloaded again
- **THEN** only URLs missing from `downloaded.txt` are fetched
