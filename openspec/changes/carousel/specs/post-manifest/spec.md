## ADDED Requirements

### Requirement: A carousel SHALL have its own status per platform

Each platform's carousel status SHALL be worked out from `post.json`, apart from the video's stage. It SHALL be one of:
- `written` once slides are set;
- `rendered` once that platform's PNGs match the slides' text, image hashes, crops, layouts and size;
- `needs-fix` or `rejected` after that review;
- `approved` while the approved PNGs are still the rendered ones.

A post with no slides SHALL have no carousel status.

#### Scenario: A post with a video and a carousel

- **WHEN** a post's draft is approved and its TikTok carousel is only rendered
- **THEN** its stage is `approved`
- **AND** its TikTok carousel status is `rendered`

### Requirement: Only a carousel's own changes SHALL undo its approval

Changing a slide's text, image, crop or layout SHALL undo that platform's approval. Changing the brand's look SHALL NOT: the approved PNGs stay approved until the carousel is rendered again.

#### Scenario: A slide changed after approval

- **WHEN** slide 2's title changes after the Instagram carousel was approved
- **THEN** the Instagram carousel status is back to `written`

#### Scenario: New brand colours

- **WHEN** the brand's accent colour changes after approval
- **THEN** the carousel stays `approved`
