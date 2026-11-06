# shorts-studio

Turn audio into vertical short videos with AI images, word-timed captions and FFmpeg: a CLI and MCP server for Instagram Reels, TikTok and YouTube Shorts.

[![CI](https://github.com/guillempuche/shorts-studio/actions/workflows/ci.yml/badge.svg)](https://github.com/guillempuche/shorts-studio/actions/workflows/ci.yml) [![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

## Why

Publishing several short videos a day leaves no time to edit them. shorts-studio lets you be the story checker and the vibe checker: you approve the script before anything is spent, and you review the draft at the end. Everything in between (transcription, beats, images, motion, captions, render) is generated, by the tool or by your AI agent driving it, and the polish happens in CapCut.

## See it work

A 60-second reel's audio, directed beat by beat: a hook title, then captions in sync, and each image moving the way its story moment calls for.

![Four frames of a draft: the hook title over a laughing woman, then captions over three AI images](docs/assets/draft-frames.png)

## How it fits together

```
audio ─▶ transcript (word timings) ─▶ beats by story moment ─▶ one image per beat ─▶ draft.mp4 ─▶ CapCut
          Together Whisper              hook, setup, tension…     FAL, or your own      FFmpeg
                        you approve the script here ▲                     you review the draft here ▲
```

Every step is a command and an MCP tool; [docs/architecture.md](docs/architecture.md) explains how and why.

## Install

| How                              | Command                                                                                         |
| -------------------------------- | ----------------------------------------------------------------------------------------------- |
| Nix (brings the FFmpeg it needs) | `nix run github:guillempuche/shorts-studio -- doctor`                                           |
| macOS, Linux                     | `curl -fsSL https://raw.githubusercontent.com/guillempuche/shorts-studio/main/install.sh \| sh` |
| Windows                          | `irm https://raw.githubusercontent.com/guillempuche/shorts-studio/main/install.ps1 \| iex`      |
| npm (Node 24+)                   | `npx -y shorts-studio doctor`                                                                   |
| From source                      | see [docs/getting-started.md](docs/getting-started.md)                                          |

`shorts-studio doctor` checks FFmpeg, keys and folders and names the fix for anything missing. Keys, Claude Code and Codex setup: [docs/getting-started.md](docs/getting-started.md).

## Quick start

```bash
shorts-studio post create --post morning-routine
shorts-studio source import --post 2026-11-06-morning-routine --file reel.mp3 --origin mine --kind speech
shorts-studio audio transcribe --post 2026-11-06-morning-routine
shorts-studio beat plan --post 2026-11-06-morning-routine
shorts-studio beat set --post 2026-11-06-morning-routine --from beats.json   # moments and image prompts
shorts-studio script set --post 2026-11-06-morning-routine --file script.md --hook "Your morning, rewired"
shorts-studio script approve --post 2026-11-06-morning-routine
shorts-studio image generate --post 2026-11-06-morning-routine --yes
shorts-studio draft render --post 2026-11-06-morning-routine
```

`post show --post <slug>` always names the next command, every command takes `--json`, and commands on posts also take `--day today` or `--in-stage <stage>` to run on several. The whole daily loop, review and CapCut included, is the [make-shorts skill](.agents/skills/make-shorts/SKILL.md).

## Use it from an AI agent

`shorts-studio mcp serve` is an MCP server over stdio with one tool per command. Claude Code reads [.mcp.json](.mcp.json) and Codex [.codex/config.toml](.codex/config.toml); any other client can point at the same command. Tools that spend money ask first, and approving a script or a draft stays with you.

## What's in it today

- From audio to a draft, with word-timed captions, a hook title and motion chosen per story moment ([the research behind it](docs/research/README.md)).
- The evening review, a frame-exact CapCut export, and records of the final video and where it was published.
- Downloads and transcription of saved reels and TikToks.
- Spending caps, resumable paid requests, and no spending before the script is approved.

The exact behaviour is specified in [openspec/specs](openspec/specs); planned work (AI voice and music, AI video for chosen beats, carousels) is in [openspec/changes](openspec/changes).

## How it compares

|                            | shorts-studio               | CapCut templates | Render APIs (JSON2Video, Creatomate) | Remotion                                           |
| -------------------------- | --------------------------- | ---------------- | ------------------------------------ | -------------------------------------------------- |
| Driven by an AI agent      | CLI and MCP                 | No               | API                                  | Code                                               |
| Images timed to the speech | Word timings, story moments | By hand          | You compute timings                  | You code it                                        |
| Where it renders           | Your machine (FFmpeg)       | The app          | Their cloud, per minute              | Your machine (Chrome)                              |
| Licence                    | Apache-2.0                  | Proprietary      | Proprietary                          | Source-available, paid for companies over 3 people |

## FAQ

**Does it cost money?** A little: Together bills transcription per audio minute and an image costs about a cent; spending caps stop overspending ([providers](docs/providers.md)).

**Can I use audio from someone else's reel?** As a guide track: the CapCut export leaves it out so you publish with the platform's sound. Rights are your responsibility.

**Which languages?** Any language Whisper detects; force one with `--language`.

## Contributing

[CONTRIBUTING.md](CONTRIBUTING.md) for how a change gets in, [AGENTS.md](AGENTS.md) for the rules, [SECURITY.md](SECURITY.md) to report a vulnerability.

## License

[Apache-2.0](LICENSE).
