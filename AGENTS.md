# AGENTS.md

Rules for people and AI agents who work in this repository. Claude Code and Codex both read this file. Don't add a `CLAUDE.md`: Claude Code would stop loading this one. For what shorts-studio is, see [README.md](README.md).

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

Run `nix develop` (or direnv with `.envrc`), then `pnpm install` and `bin/shorts-studio doctor`. Run `doctor` before you decide something is broken. A missing key, or an FFmpeg without libass, fails in ways that look like bugs.

## How to work

- **Behaviour changes start in OpenSpec.** `openspec/specs/` is how the system behaves today. `openspec/changes/` is pending work. Propose a change (`openspec-propose` skill) before you write code. Keep `openspec validate --all --strict` passing. Archive the change once it ships.
- **Tests** are plain vitest in `test/`, one file per subject, with `// GIVEN / WHEN / THEN` comments. Anything that needs ffmpeg, the network or a paid API goes in `*.integration.test.ts` and runs only on request (`pnpm test:integration`). Providers are faked (`test/support/fake-fal.ts`).
- **A new operation** goes in `src/operations/` and `src/operations/index.ts`. It then appears on both the CLI and MCP, and the parity test checks both.
- **Checks before pushing:** `pnpm check && pnpm check-types && pnpm test && pnpm check-links`. After you change the Post schema, run `pnpm schemas`. After you change `pnpm-lock.yaml`, update the hash in `nix/package.nix` (`nix build` prints it).
- **Before committing a larger change,** review it. Use Effect where it fits, and check its API in the installed `.d.ts`. Comments explain why, in a line or two. Run the `readability-improver` agent over the changed code.

## Rules

1. **No secrets in git.** Key names live in [.env.example](.env.example). Key values live in the environment or the macOS Keychain. Never print or log them.
2. **No user content in git.** Posts, media, `brand.json` and the ledger live under `SHORTS_POSTS_DIR` / `SHORTS_DATA_DIR`.
3. **Brand-neutral.** No product, client or brand names in code, docs or samples.
4. **One place per fact.** Link to it instead of repeating it. The table above says where each thing lives.
5. **The user decides.** Approving a script (`script approve`) or a draft (`post review`) is CLI-only. Never run them for the user. Run spending commands with `--dry-run` first and show the estimate. The repo's agent settings ask before each paid call. Never raise spending caps unless the user asks.
6. **Effect at the seams.** The repo uses `effect@4.1.2` (`effect/cli`, `effect/ai`). Operations are plain functions over a `Context`. Child processes use `spawn` with `stopWhenAborted`. Files use `node:fs`. Check every API against `node_modules/effect/dist/**/*.d.ts` or [docs/vendors/effect](docs/vendors/README.md), never from memory. Why: [key decisions](docs/architecture.md#key-decisions).

## Skills

Edit skills only in `.agents/skills/`, where Codex reads them. Then run `pnpm skills:sync`. `.claude/skills/` is a copy for Claude Code, and the pre-commit hook refuses a commit where the two differ. `openspec update` generates the `openspec-*` skills, so don't edit them by hand. `commit`, `pr`, `test-bdd` and the `readability-improver` agent come from the `guillempuche/ai-standards` plugin marketplace ([setup per tool](docs/getting-started.md#agents)).
