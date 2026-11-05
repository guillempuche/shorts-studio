# shorts-studio

Turn audio into vertical short videos with AI images, word-timed captions and FFmpeg: a CLI and MCP server for Instagram Reels, TikTok and YouTube Shorts.

You (or your AI agent) bring the audio: your own recording, a reel you saved, a voiceover or a music track. shorts-studio transcribes it with word timings, cuts it into beats of 1.5–3 seconds, generates one image per beat, and renders a 1080×1920 draft with captions in sync. You approve the story before anything is spent and review the draft at the end; polish happens in CapCut.

[![CI](https://github.com/guillempuche/shorts-studio/actions/workflows/ci.yml/badge.svg)](https://github.com/guillempuche/shorts-studio/actions/workflows/ci.yml) [![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

> **Status:** milestone 1, the path from audio to a reviewable draft. See [what's next](#roadmap).

## Who it's for

Creators who publish several short videos a day and want to be the story checker and the vibe checker, not the editor. And AI agents (Claude Code, Codex, any MCP client) that do the work in between.

## How it works

```
audio ─▶ transcript (word timings) ─▶ beats ─▶ one image per beat ─▶ draft.mp4 ─▶ CapCut
            Together Whisper           1.5–3 s      FAL (paid)        FFmpeg
                                  you approve the script here ▲          you review here ▲
```

The details, and why it's built this way, are in [docs/architecture.md](docs/architecture.md).

## Quick start

Requirements: Node 24+, and FFmpeg built with libass (the Nix shell provides both). Setup for Nix, keys, Claude Code and Codex is in [docs/getting-started.md](docs/getting-started.md).

```bash
git clone https://github.com/guillempuche/shorts-studio && cd shorts-studio
nix develop          # or: install Node 24 and an FFmpeg with libass yourself
pnpm install
bin/shorts-studio config show
```

One post, from a reel's audio to a draft:

```bash
bin/shorts-studio post create --post morning-routine
bin/shorts-studio source import --post 2026-11-04-morning-routine --file reel.mp3 --origin mine --kind speech
bin/shorts-studio audio transcribe --post 2026-11-04-morning-routine
bin/shorts-studio beat plan --post 2026-11-04-morning-routine
bin/shorts-studio beat set --post 2026-11-04-morning-routine --from prompts.json
bin/shorts-studio script set --post 2026-11-04-morning-routine --file script.md
bin/shorts-studio script approve --post 2026-11-04-morning-routine
bin/shorts-studio image generate --post 2026-11-04-morning-routine --dry-run
bin/shorts-studio image generate --post 2026-11-04-morning-routine --yes
bin/shorts-studio draft render --post 2026-11-04-morning-routine
```

Then you review the draft (`post review`), hand it to CapCut (`capcut export`), and record the final video and where you published it. Every command takes `--json`, and `post show --post <slug>` always tells you the next command. The daily loop for an agent is in the [make-shorts skill](.agents/skills/make-shorts/SKILL.md).

## Use it from an AI agent

`shorts-studio mcp serve` is an MCP server over stdio with one tool per command (`post_show`, `image_generate`, …). Claude Code reads [.mcp.json](.mcp.json) and Codex [.codex/config.toml](.codex/config.toml); both start the server from this checkout, and it reads API keys from your environment or Keychain.

## FAQ

### How do I make a short video from a reel's audio?

Import the audio, transcribe, plan beats, write prompts, approve the script, generate images and render. The [quick start](#quick-start) is the whole path.

### Does it cost money?

Yes, a little: Together bills transcription per audio minute, and images cost about $0.008 each with the default model. Caps per day and per post stop overspending: see [docs/providers.md](docs/providers.md).

### Can an agent spend money without me?

No. Image generation needs your script approval, which only the CLI can give, and the repository's agent settings ask before each paid tool call. See [spend-budget](openspec/specs/spend-budget/spec.md).

### Can I use audio from someone else's reel?

As a guide track, yes; publish with the platform's in-app sound instead of uploading theirs. Downloading and rights are your responsibility.

### Which languages are supported?

Any language Whisper detects; force one with `audio transcribe --language es`.

## Roadmap

Planned work lives in [openspec/changes](openspec/changes): review and CapCut hand-off, voice and music, AI video for chosen beats, carousels, and the daily loop.

## Contributing

Read [AGENTS.md](AGENTS.md) first: it holds the rules for people and agents alike.

## License

[Apache-2.0](LICENSE).
