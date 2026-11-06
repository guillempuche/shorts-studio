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
---

Settings for the `commit` and `pr` skills. Formatting runs in the lefthook pre-commit hook, so no formatter is listed. Changes under `openspec/` are `docs` with the scope `openspec`.
