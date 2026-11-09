## ADDED Requirements

### Requirement: The MCP server SHALL speak the newest protocol and keep older clients

The MCP server SHALL serve protocol versions 2026-07-28, 2025-11-25 and 2025-06-18. A 2026-07-28 request SHALL get the same tools, results and error objects as a request on an earlier version. A client that initializes with an offered version SHALL get that version; one that asks for any other version SHALL get 2025-11-25.

#### Scenario: A client on 2026-07-28

- **WHEN** a client sends 2026-07-28 requests, without initializing, to list the tools and to call `post_show` for a post that doesn't exist
- **THEN** it gets every shared tool
- **AND** the call returns the `{ code, message, fix }` error object with `isError: true`

#### Scenario: A client on an earlier version

- **WHEN** a client initializes with 2025-06-18
- **THEN** the server answers with 2025-06-18

#### Scenario: A client on a version the server doesn't offer

- **WHEN** a client initializes with 2025-03-26
- **THEN** the server answers with 2025-11-25
