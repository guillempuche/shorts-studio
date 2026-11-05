## ADDED Requirements

### Requirement: A post SHALL record its life after the draft

The manifest SHALL record the review, the final video, every platform it was published on (one record per platform) and when it was archived; the stage SHALL follow them: `needs-fix`, `rejected`, `approved`, `final`, `posted`, `archived`. Archived posts SHALL be listed only when asked for by stage.

#### Scenario: Finalizing before approval

- **WHEN** a final video is recorded for a draft that isn't approved
- **THEN** it is refused with `needs-confirmation`
