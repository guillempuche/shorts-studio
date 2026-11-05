## ADDED Requirements

### Requirement: Spend SHALL be visible

`budget show` SHALL report today's spend and each post's total against the daily and per-post caps, counting reservations still in flight at their estimate.

#### Scenario: After generating images

- **WHEN** a post's images were generated today
- **THEN** today's total and the post's total include their cost
