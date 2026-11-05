## ADDED Requirements

### Requirement: Beats SHALL carry their story moment

Each beat MAY record a story moment (`hook`, `setup`, `tension`, `twist`, `vulnerable`, `payoff`, `cta`) and a motion override. Both SHALL be part of the draft's input hash, so changing them makes the draft stale.

#### Scenario: Setting a moment

- **WHEN** `beat set` gives beat 0 the moment `hook`
- **THEN** the manifest records it and the next `draft render` renders again
