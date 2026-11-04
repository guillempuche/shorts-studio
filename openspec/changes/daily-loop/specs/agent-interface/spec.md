## ADDED Requirements

### Requirement: The daily-loop skill SHALL be served over MCP

The MCP server SHALL publish the `make-shorts` skill with the MCP Skills extension, so clients without the repository checked out can follow the loop.

#### Scenario: A client lists skills

- **WHEN** an MCP client lists the server's skills
- **THEN** `make-shorts` is listed with its SKILL.md
