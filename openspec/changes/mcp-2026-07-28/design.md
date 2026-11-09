## Context

`mcpServerLayer` passes Effect's `McpServer.layerStdio` a list of protocol adapters: `v2025_11_25` and `v2025_06_18`. Effect 4.1.2 also has `v2026_07_28`, a stateless adapter: no `initialize`, and each request carries its version, capabilities and client info in `params._meta`. One stdio server can take stateful and stateless adapters together.

A test with a stub tool on Effect's stdio server, before any change here, found:

| List              | `initialize` 2026-07-28 / 2025-11-25 / 2025-06-18 / 2025-03-26 | A 2026-07-28 `tools/call` |
| ----------------- | -------------------------------------------------------------- | ------------------------- |
| today's           | 2025-11-25 / 2025-11-25 / 2025-06-18 / 2025-11-25              | `-32603 Internal error`   |
| 2026-07-28 first  | same                                                           | answered                  |
| 2026-07-28 second | same                                                           | answered                  |

The MCP tests build their client with `McpTest.makeClient(..., { protocols: [McpProtocol.v2025_11_25] })`, so they cover one version only, and not the list the server uses.

## Goals / Non-Goals

**Goals:**

- A 2026-07-28 client gets the same tools and the same `{ code, message, fix }` failures as an earlier client.
- The tests run on every version the server offers.

**Non-Goals:**

- Changing how a tool's bad arguments come back. Effect decides that per version: 2025-11-25 and 2025-06-18 return a JSON-RPC `-32602` error, and 2026-07-28 returns a tool result with `isError: true` and Effect's own text, as the 2026-07-28 spec asks. Neither is the `{ code, message, fix }` object.

## Decisions

**List 2026-07-28 first.** Newest first reads as the server's preference and matches Effect's own examples. The test above found the order changes no answer: `initialize` never selects the stateless adapter, so a client asking for an unoffered version still gets 2025-11-25 whatever the order. Alternative: keep 2025-11-25 first so the list matches `initialize`'s fallback; rejected, since the order doesn't set the fallback.

**One exported list, `MCP_PROTOCOLS`.** `mcpServerLayer` and the tests both read it. The tests run each case once per version with `describe.each`, passing the list as `protocols` and the version as `protocolVersion`. Alternative: one extra test for 2026-07-28; rejected, because the next version added would again go untested.

**The handlers stay as they are.** A stateless request gets no `McpServerClient`, and Effect's types now leave it out of the services the handlers receive. The handlers use only the ports and `Context`, so they need no change; `check-types` confirms it.

## Risks / Trade-offs

- [Effect marks `McpProtocol` and `McpServer` unstable] → The version is pinned at 4.1.2, and the per-version tests catch a change on upgrade.
- [Cancelling a call works differently without a session] → The existing cancel test runs on 2026-07-28 too. If Effect can't cancel a stateless call in memory, that test is skipped for 2026-07-28 with a comment, and the gap is named in the changelog.
- [A client sends 2026-07-28 `_meta` to a server built before this change] → It gets `-32603`, as today. Nothing to migrate: the binary and the client configs are unchanged.
