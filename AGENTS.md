# AGENTS.md

Rules for people and AI agents working in this repository. Claude Code and Codex both read this file; don't add a `CLAUDE.md`, or Claude Code stops loading this one. What shorts-studio is: [README.md](README.md).

## Where things are

| Topic                                               | Source                                                                                                                |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Commands, flags and outputs                         | `bin/shorts-studio --help`, `bin/shorts-studio schema show`, or MCP `tools/list`                                      |
| Architecture, data model, exit codes, key decisions | [docs/architecture.md](docs/architecture.md)                                                                          |
| Behaviour today (specs) and planned changes         | [openspec/](openspec/)                                                                                                |
| Every number for pacing, motion and captions        | [src/domain/direction.ts](src/domain/direction.ts)                                                                    |
| The evidence behind those numbers                   | [docs/research/](docs/research/README.md)                                                                             |
| Providers, keys and costs                           | [docs/providers.md](docs/providers.md)                                                                                |
| Installing, keys, Claude Code and Codex setup       | [docs/getting-started.md](docs/getting-started.md)                                                                    |
| Getting a change in, releasing                      | [CONTRIBUTING.md](CONTRIBUTING.md), [CHANGELOG.md](CHANGELOG.md)                                                      |
| Vendored Effect source                              | [docs/vendors/README.md](docs/vendors/README.md)                                                                      |
| The daily loop; directing beats                     | [make-shorts](.agents/skills/make-shorts/SKILL.md), [story-direction](.agents/skills/story-direction/SKILL.md) skills |

## Setup

`nix develop` (or direnv with `.envrc`), then `pnpm install` and `bin/shorts-studio doctor`. Run `doctor` before concluding something is broken: a missing key or an FFmpeg without libass fails in ways that look like bugs.

## How to work

- **Behaviour changes start in OpenSpec.** `openspec/specs/` is how the system behaves today, `openspec/changes/` is pending work. Propose a change (`openspec-propose` skill) before the code, and keep `openspec validate --all --strict` passing. Archive the change once it ships.
- **Tests** are plain vitest beside their subject in `test/`, with `// GIVEN / WHEN / THEN` comments. Anything needing ffmpeg, the network or a paid API is `*.integration.test.ts` and opt-in (`pnpm test:integration`); providers are faked (`test/support/fake-fal.ts`).
- **A new operation** goes in `src/operations/` and `src/operations/index.ts`, and appears on the CLI and MCP; the parity test checks both.
- **Checks before pushing:** `pnpm check && pnpm check-types && pnpm test && pnpm check-links`. After changing the Post schema, `pnpm schemas`; after changing `pnpm-lock.yaml`, update the hash in `nix/package.nix` (`nix build` prints it).
- **Before committing a larger change,** review it: Effect used where it fits (check the API in the installed `.d.ts`), comments that explain why in a line or two, and the `readability-improver` agent over the changed code.

## Rules

1. **No secrets in git.** Key names live in [.env.example](.env.example); values live in the environment or the macOS Keychain, and are never printed or logged.
2. **No user content in git.** Posts, media, `brand.json` and the ledger live under `SHORTS_POSTS_DIR` / `SHORTS_DATA_DIR`.
3. **Brand-neutral.** No product, client or brand names in code, docs or samples.
4. **One place per fact.** Link instead of repeating; the table above says where each thing lives.
5. **The user decides.** Approving a script (`script approve`) or a draft (`post review`) is CLI-only: never run them for the user. Run spending commands with `--dry-run` first and show the estimate; the repo's agent settings ask before each paid call. Never raise spending caps unasked.
6. **Effect at the seams.** `effect@4.1.2` (`effect/cli`, `effect/ai`): operations are plain functions over a `Context`, child processes use `spawn` with `stopWhenAborted`, files use `node:fs`. Check every API against `node_modules/effect/dist/**/*.d.ts` or [docs/vendors/effect](docs/vendors/README.md), never memory. Why: [key decisions](docs/architecture.md#key-decisions).

## Skills

Edit skills in `.agents/skills/` only (Codex reads them there), then `pnpm skills:sync`: `.claude/skills/` is a copy for Claude Code, and the pre-commit hook refuses drift. The `openspec-*` skills are generated by `openspec update`; don't hand-edit them. `commit`, `pr`, `test-bdd` and the `readability-improver` agent come from the `guillempuche/ai-standards` plugin marketplace ([setup per tool](docs/getting-started.md#agents)).
