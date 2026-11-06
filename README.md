# shorts-studio

Turn audio into short vertical videos with AI images, word-timed captions and FFmpeg. shorts-studio is a CLI and MCP server for Instagram Reels, TikTok and YouTube Shorts.

[![CI](https://github.com/guillempuche/shorts-studio/actions/workflows/ci.yml/badge.svg)](https://github.com/guillempuche/shorts-studio/actions/workflows/ci.yml) [![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

## Why

If you post several short videos a day, you have no time to edit them. With shorts-studio, you only check the story and the vibe. You approve the script before any money is spent, and you review the draft at the end. The tool, or your AI agent driving it, makes everything in between: transcription, beats, images, motion, captions and the render. You do the final polish in CapCut.

## See it work

This draft comes from the audio of a 60-second reel, directed beat by beat. A hook title comes first. Then the captions follow the speech, and each image moves to suit its story moment.

![Four frames of a draft: the hook title over a laughing woman, then captions over three AI images](docs/assets/draft-frames.png)

## How it fits together

```
audio ─▶ transcript (word timings) ─▶ beats by story moment ─▶ one image per beat ─▶ draft.mp4 ─▶ CapCut
          Together Whisper              hook, setup, tension…     FAL, or your own      FFmpeg
                        you approve the script here ▲                     you review the draft here ▲
```

Every step is both a command and an MCP tool. [docs/architecture.md](docs/architecture.md) explains how and why.

## Install

| How                              | Command                                                                                         |
| -------------------------------- | ----------------------------------------------------------------------------------------------- |
| Nix (brings the FFmpeg it needs) | `nix run github:guillempuche/shorts-studio -- doctor`                                           |
| macOS, Linux                     | `curl -fsSL https://raw.githubusercontent.com/guillempuche/shorts-studio/main/install.sh \| sh` |
| Windows                          | `irm https://raw.githubusercontent.com/guillempuche/shorts-studio/main/install.ps1 \| iex`      |
| From source                      | see [docs/getting-started.md](docs/getting-started.md)                                          |

`shorts-studio doctor` checks FFmpeg, your keys and your folders. If anything is missing, it tells you the fix. To set up keys, Claude Code and Codex, see [docs/getting-started.md](docs/getting-started.md).

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

`post show --post <slug>` always tells you the next command. Every command takes `--json`. Commands on posts also take `--day today` or `--in-stage <stage>` to run on several posts at once. The [make-shorts skill](.agents/skills/make-shorts/SKILL.md) covers the whole daily loop, including the review and CapCut.

## Use it from an AI agent

`shorts-studio mcp serve` runs an MCP server over stdio, with one tool per command. Claude Code reads [.mcp.json](.mcp.json), and Codex reads [.codex/config.toml](.codex/config.toml). Any other client can point at the same command. Tools that spend money ask first. Only you can approve a script or a draft.

## What's in it today

- Audio to draft, with word-timed captions, a hook title and motion picked for each story moment ([the research behind it](docs/research/README.md)).
- An evening review, a frame-exact CapCut export, and a record of the final video and where you published it.
- Download and transcribe saved reels and TikToks.
- Spending caps, paid requests that can resume, and no spending until you approve the script.

[openspec/specs](openspec/specs) describes exactly how it behaves. Planned work is in [openspec/changes](openspec/changes): AI voice and music, AI video for chosen beats, and carousels.

## How it compares

|                            | shorts-studio               | CapCut templates | Render APIs (JSON2Video, Creatomate) | Remotion                                           |
| -------------------------- | --------------------------- | ---------------- | ------------------------------------ | -------------------------------------------------- |
| Driven by an AI agent      | CLI and MCP                 | No               | API                                  | Code                                               |
| Images timed to the speech | Word timings, story moments | By hand          | You compute timings                  | You code it                                        |
| Where it renders           | Your machine (FFmpeg)       | The app          | Their cloud, per minute              | Your machine (Chrome)                              |
| Licence                    | Apache-2.0                  | Proprietary      | Proprietary                          | Source-available, paid for companies over 3 people |

## FAQ

**Does it cost money?** A little. Together charges for transcription by the minute of audio, and an image costs about a cent. Spending caps stop you from overspending ([providers](docs/providers.md)).

**Can I use audio from someone else's reel?** Yes, as a guide track. The CapCut export leaves it out, so you publish with the platform's sound. The rights are your responsibility.

**Which languages?** Any language Whisper detects. To force one, use `--language`.

## Contributing

To get a change in, read [CONTRIBUTING.md](CONTRIBUTING.md). The rules are in [AGENTS.md](AGENTS.md). To report a vulnerability, see [SECURITY.md](SECURITY.md).

## License

[Apache-2.0](LICENSE).
