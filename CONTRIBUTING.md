# Contributing

Thanks for helping. The rules for people and AI agents are the same, and they live in [AGENTS.md](AGENTS.md); this page only covers how a change gets in.

## Before you start

- Behaviour changes start as an OpenSpec change: see [How to work](AGENTS.md#how-to-work). Small fixes don't need one.
- For anything larger than a fix, open an issue first so we agree on the approach.

## Making the change

1. `nix develop` (or direnv), then `pnpm install`. Details: [docs/getting-started.md](docs/getting-started.md).
2. Write tests with the change ([how tests are written](AGENTS.md#how-to-work)).
3. Before pushing: `pnpm check && pnpm check-types && pnpm test && pnpm check-links`. The git hooks run part of this; CI runs all of it.
4. Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`…).
5. Add a line under `[Unreleased]` in [CHANGELOG.md](CHANGELOG.md) for anything a user would notice.

## Releasing (maintainers)

Move the `[Unreleased]` entries to a new version section in CHANGELOG.md, set the same version in package.json, commit, then push a tag `v<version>`. The release workflow builds the binaries, publishes the GitHub Release with that section as its notes, and publishes to npm when the `NPM_PUBLISH` repository variable is `true`. If `pnpm-lock.yaml` changed, update the hash in `nix/package.nix` first (`nix build` prints it).

By contributing you agree your work is licensed under the [Apache-2.0](LICENSE) licence.
