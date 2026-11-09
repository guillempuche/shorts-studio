## 1. Server

- [x] 1.1 Export `MCP_PROTOCOLS` from `apps/mcp/src/mcp.ts` as `[v2026_07_28, v2025_11_25, v2025_06_18]`, use it in `mcpServerLayer`, and correct the comment on how a version is chosen; verify with `pnpm check-types`

## 2. Tests

- [x] 2.1 Run every MCP test once per version in `MCP_PROTOCOLS` (`describe.each`, `makeClient` with the list and `protocolVersion`); verify `pnpm --filter @shorts-studio/mcp test` passes on all three, and the 2026-07-28 run lists every shared tool and returns the `{ code, message, fix }` error object for a missing post
- [x] 2.2 If cancelling can't work on 2026-07-28 in memory, skip only that case for 2026-07-28, with a comment saying why; verify the other two versions still run it (not needed: the cancel case passes on all three versions)

## 3. Docs

- [x] 3.1 Name the offered MCP versions in `docs/architecture.md` (Agent interface) and add the change to `CHANGELOG.md`; verify with `pnpm check-links`

## 4. Check

- [x] 4.1 Run `pnpm check && pnpm check-types && pnpm test && pnpm check-links` and `openspec validate --all --strict`; all pass
- [x] 4.2 Start `bin/shorts-studio mcp serve` and send it `initialize` with 2026-07-28, 2025-11-25, 2025-06-18 and 2025-03-26, and a 2026-07-28 `tools/call` without `initialize`; the answers are 2025-11-25, 2025-11-25, 2025-06-18, 2025-11-25, and a tool result
