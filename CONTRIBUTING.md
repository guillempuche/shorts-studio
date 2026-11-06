# Contributing

Thanks for helping. People and AI agents follow the same rules, and they live in [AGENTS.md](AGENTS.md). This page only covers how to get a change in.

## Before you start

- Behaviour changes start as an OpenSpec change (see [How to work](AGENTS.md#how-to-work)). Small fixes don't need one.
- For anything bigger than a fix, open an issue first so we can agree on the approach.

## Making the change

1. Run `nix develop` (or direnv), then `pnpm install`. Details are in [docs/getting-started.md](docs/getting-started.md).
2. Write tests with the change ([how tests are written](AGENTS.md#how-to-work)).
3. Before pushing, run `pnpm check && pnpm check-types && pnpm test && pnpm check-links`. The git hooks run part of this, and CI runs all of it.
4. Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:`…).
5. Add a line under `[Unreleased]` in [CHANGELOG.md](CHANGELOG.md) for anything a user would notice.

## Releasing (maintainers)

If `pnpm-lock.yaml` changed, first update the `pnpmDeps` hash in `flake.nix` (`nix build` prints it). Move the `[Unreleased]` entries to a new version section in CHANGELOG.md. Set the same version in `apps/cli/package.json` and commit. Then push a tag `v<version>`.

The release workflow compiles the binaries with Bun, straight from the TypeScript. It publishes the GitHub Release, with that CHANGELOG.md section as its notes.

By contributing, you agree that your work is licensed under the [Apache-2.0](LICENSE) licence.
