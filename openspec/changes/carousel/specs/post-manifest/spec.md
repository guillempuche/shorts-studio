## ADDED Requirements

### Requirement: A carousel SHALL have its own status

A post's carousel status SHALL be worked out from `post.json`, apart from the video's stage: `written` once slides are set, `rendered` once its slides match the current text, images and layout, and `approved` once the user approved those. A post with no slides SHALL have no carousel status.

#### Scenario: A post with a video and a carousel

- **WHEN** a post's draft is approved and its carousel is only rendered
- **THEN** its stage is `approved`
- **AND** its carousel status is `rendered`
