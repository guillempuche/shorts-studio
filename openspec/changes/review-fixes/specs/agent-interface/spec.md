## ADDED Requirements

### Requirement: The user's decisions SHALL need an interactive terminal

`script approve` and `post review` SHALL refuse with code `needs-confirmation`, and record nothing, when stdin isn't an interactive terminal. An agent's shell has none, so no agent can run them, whatever form the command takes.

#### Scenario: An agent runs an approval

- **WHEN** `script approve` runs with stdin that isn't a terminal
- **THEN** the script stays unapproved
- **AND** the command exits 3
- **AND** the fix asks the user to run it in their own terminal

#### Scenario: The user approves

- **WHEN** the user runs `script approve` in their terminal
- **THEN** the script is approved
