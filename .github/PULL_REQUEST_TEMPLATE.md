## What and why

<!-- One or two sentences. Link the issue or OpenSpec change. -->

## Verification

<!-- What you ran as a user would, and what you saw. Agents: the verify skill (.agents/skills/verify/SKILL.md) writes this section. -->

## Checks

- [ ] `pnpm check && pnpm check-types && pnpm test && pnpm check-links` pass
- [ ] Behaviour changes have an OpenSpec change, and `openspec validate --all --strict` passes
- [ ] CHANGELOG.md has a line under `[Unreleased]` if users will notice
