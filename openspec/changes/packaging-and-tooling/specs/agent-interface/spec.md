## ADDED Requirements

### Requirement: Schemas SHALL be discoverable without MCP

`schema` SHALL print the JSON Schema of the post manifest and of each command's input and output, generated from the same Schemas the commands use.

#### Scenario: An agent without MCP

- **WHEN** it runs `schema post`
- **THEN** it receives the post manifest's JSON Schema
