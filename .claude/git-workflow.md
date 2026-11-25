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
---

Settings for the `commit` and `pr` skills. Formatting runs in the lefthook pre-commit hook, so no formatter is listed. Changes under `openspec/` are `docs` with the scope `openspec`.

Run every gate inside `nix develop`. There is no build gate: the release binary is compiled with Bun in CI and smoke-tested there.

The `verify` skill writes the PR's `## Verification` section. Spending commands only run with `--dry-run` or against its dead provider ports, and `script approve` and `post review` stay the user's ([AGENTS.md rule 5](../AGENTS.md#rules)).
