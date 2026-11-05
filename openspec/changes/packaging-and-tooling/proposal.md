# Packaging and tooling

## Why

shorts-studio runs from a clone today. Installing it with npx, checking a machine in one command, discovering schemas without MCP, and working on several posts at once would make it usable by people and agents who don't clone the repo.

## What Changes

- An npm package with a build step, so `npx -y shorts-studio mcp serve` works (Node won't strip TypeScript types under node_modules).
- `doctor`: the environment checks from `config show` as their own command, with exit codes.
- `schema`: the JSON Schema of the post manifest and of each command's input and output; `schemas/post.schema.json` generated and checked in CI.
- Batching: `--post a,b`, `--day today` and `--in-stage <stage>` on the commands that act on posts.
- CONTRIBUTING.md, SECURITY.md, issue and PR templates, a link check in CI, Codex rules for paid commands.

Out of scope: hosting, a GUI.
