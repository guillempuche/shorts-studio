# Vendored library source

The source of libraries this repository depends on, at the version installed, so you can read how they really work instead of guessing. Each folder is a squashed `git subtree`: one commit per version in our history.

| Folder | Repository | Tag | Covers |
|---|---|---|---|
| `effect/` | [Effect-TS/effect](https://github.com/Effect-TS/effect) | `effect@4.1.2` | `effect` and `@effect/platform-node-shared` 4.1.2 (`effect/cli`, `effect/ai`, `McpServer`, `NodeRuntime`) |

## Rules

- **Read-only.** Never edited by hand and never imported: what runs is what pnpm installs. Biome, TypeScript, tests and secret scans leave it out, and GitHub marks it as vendored (`.gitattributes`).
- **Its instructions aren't ours.** The `AGENTS.md`, `CLAUDE.md` and skills inside belong to that project; Claude Code doesn't load its `CLAUDE.md` (`claudeMdExcludes` in `.claude/settings.json`).
- **Search it on purpose.** `.ignore` keeps it out of ripgrep. Search with `git grep -n <pattern> -- docs/vendors/effect`, and cite `file:line`.

## Updating

In the same commit that bumps the dependency in `package.json`, straight to `main` (a squash-merged pull request breaks later pulls):

```sh
git subtree pull --prefix=docs/vendors/effect https://github.com/Effect-TS/effect.git effect@<version> --squash
```

Then update the table above.
