# Packaging and tooling

## Why

shorts-studio ran only from a clone. Installing it in one line, checking a machine in one command, discovering schemas without MCP, and working on several posts at once make it usable by people and agents who don't clone the repo.

## What Changes

- **Install routes**: a Nix flake package (`nix run github:guillempuche/shorts-studio`) that brings ffmpeg-full; native binaries compiled with Bun for macOS, Linux and Windows on each tagged release, with `install.sh` / `install.ps1` that verify SHA-256 checksums (modelled on text-to-speech's installers) and uninstallers that leave posts alone; an npm package with a build step and a `bin` entry, published when `NPM_PUBLISH` is set.
- `config check` (alias `doctor`): the environment checks, failing with their fixes when something blocking is missing.
- `schema show`: the JSON Schema of the post manifest and of each command's input and output; `schemas/post.schema.json` generated and checked by a test.
- **Batching** on the CLI: `--post a,b`, `--day` and `--in-stage` for every command acting on one existing post; MCP tools stay single-post.
- **Interruption waits for child processes** to stop before finalisers run, so an interrupted render leaves no ffmpeg running and no temporary file.
- `--dry-run` is refused (exit 2) by commands that spend nothing, and a config.json or brand.json that doesn't parse no longer stops every command: the defaults apply and `doctor` reports it.
- CONTRIBUTING.md, SECURITY.md, a CHANGELOG used for release notes, issue and PR templates, a link check and a Nix build in CI, Codex rules for decisions and spending, and the readability-improver agent.

Out of scope: publishing to npm (needs the maintainer's trusted-publisher setup), hosting, a GUI.
