# MCP 2026-07-28

## Why

The newest MCP revision is 2026-07-28, but the server offers only 2025-11-25 and 2025-06-18. A client that asks for 2026-07-28 gets 2025-11-25 instead, and a client that speaks only 2026-07-28, which sends no `initialize`, isn't served at all. Effect 4.1.2, which the repo already uses, ships the 2026-07-28 protocol.

## What Changes

- **The server offers 2026-07-28.** A client that sends a 2026-07-28 request (no `initialize`; the version, capabilities and client info travel with each request) is answered with the same tools, results and errors as a client on an earlier version.
- **Earlier clients keep their version.** A client that initializes with 2025-11-25 or 2025-06-18 gets that version, as now. A client that asks for a version the server doesn't offer gets 2025-11-25, as now.
- **One list of versions.** The server and its tests read the same list, so the tests cover every version the server offers.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `agent-interface`: adds which MCP protocol versions the server offers and what a client asking for each one gets.

## Impact

- `apps/mcp/src/mcp.ts`: the protocol list.
- `apps/mcp/src/mcp.test.ts`: the tests run against every offered version.
- `CHANGELOG.md` and `docs/architecture.md`.
- No new dependency. MCP clients set up in `.mcp.json` and `.codex/config.toml` need no change.

Not part of this change: returning a tool's bad arguments as a tool error with `isError: true` instead of a JSON-RPC error (MCP's SEP-1303, already part of 2025-11-25), rejecting unknown tool fields, the HTTP transport, and anything that needs a client session (elicitation, sampling), which 2026-07-28 requests don't have.
