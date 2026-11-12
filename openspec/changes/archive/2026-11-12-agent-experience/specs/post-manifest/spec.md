## MODIFIED Requirements

### Requirement: A post SHALL record what happens after the draft

`post.json` SHALL record the review, the final video, each platform the post was published on (one record per platform) and when it was archived. The stage SHALL follow these: `needs-fix`, `rejected`, `approved`, `final`, `posted`, `archived`. Archived posts SHALL be listed only when someone asks for them by stage.

#### Scenario: Finalizing before approval

- **WHEN** a final video is recorded for a draft that isn't approved
- **THEN** the command refuses with `needs-approval`
