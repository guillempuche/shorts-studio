---
platform: github
default-branch: main
attribution: none
types: [cicd, ai]
scopes:
  apps/cli: cli
  apps/mcp: mcp
  packages/domain: domain
  packages/usecases: usecases
  packages/providers: providers
  packages/tsconfig: tsconfig

gates:
  install: pnpm install
  typecheck: pnpm check-types
  lint: pnpm check
  test: pnpm test
  links: pnpm check-links
  openspec: openspec validate --all --strict

ci:
  checked-bases: [main]

roles:
  verify: verify
  code-review: code-review
  readability: readability-improver:readability-improver
  security: security-review

blast-radius:
  - Spending (packages/providers/, the ledger, money and caps, the paid operations) - say whether a run can now cost more, reserve twice, or skip its dry run.
  - The user's decisions (inputs.ts, context.ts, script approve, post review) - say whether an agent's shell or MCP could now get past the terminal check.
  - Keys and the Keychain - say whether a key could now be printed, logged, or read when it was unset.
  - Releases and dependencies (.github/, bin/, flake.nix, the lockfile, the CLI version) - say what changes for someone who installs the next release.
  - Agent rules and verification (AGENTS.md, .agents/, .claude/, scripts/verify-flows.ts, scripts/check-verification.ts) - say what agents now do differently, or what verification no longer catches.
---

Settings for the `commit` and `pr` skills. Formatting runs in the lefthook pre-commit hook, so no formatter is listed. Changes under `openspec/` are `docs` with the scope `openspec`.

Run every gate inside `nix develop`. There is no build gate: the release binary is compiled with Bun in CI and smoke-tested there.

The `verify` skill writes the PR's `## Verification` section. Spending commands only run with `--dry-run` or against its dead provider ports, and `script approve` and `post review` stay the user's ([AGENTS.md rule 5](../AGENTS.md#rules)).
