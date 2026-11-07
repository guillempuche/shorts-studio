# Getting started

How to set up a machine to run shorts-studio, and how to connect Claude Code or Codex to it.

## Install

Pick one option from the [README's install table](../README.md#install). Nix is the easiest on macOS and Linux. It brings an FFmpeg built with libass, which captions need. Many FFmpeg builds lack libass, Homebrew's included. With the binary, install FFmpeg yourself and check that `ffmpeg -filters` lists `subtitles`.

## From source

`nix develop` gives you Node 26, ffmpeg-full and OpenSpec. With direnv, `.envrc` enters that shell when you `cd` into the folder and puts `bin/` on your PATH. Then run `pnpm install` and use `bin/shorts-studio`. Outside the Nix shell, an older corepack may fail to start pnpm 12.

## Keys and folders

1. Set `TOGETHER_API_KEY` and `FAL_KEY` (see [providers](providers.md#keys)).
2. By default, posts go in your system's application-data folder. To choose another place, set `SHORTS_POSTS_DIR` (and `SHORTS_DATA_DIR`) in your shell profile.
3. `shorts-studio doctor` should end with `Ready.`

## Settings

Two optional files in the data folder hold your settings: `config.json` (providers, spending caps, captions, downloads) and `brand.json` (the style added to every image prompt). Start each with a `$schema` line, and your editor completes and checks them:

```json
{
  "$schema": "https://raw.githubusercontent.com/guillempuche/shorts-studio/main/schemas/config.schema.json",
  "caps": { "dailyUsd": 5, "postUsd": 2 },
  "image": { "provider": "fal", "model": "flux-schnell" }
}
```

Any setting can also come from the environment, which wins over the file: `SHORTS_` and the setting's path in capitals, such as `SHORTS_IMAGE_MODEL=flux-dev` or `SHORTS_CAPS_DAILY_USD=10`. brand.json's settings use `SHORTS_BRAND_`, such as `SHORTS_BRAND_IMAGE_PROMPT_SUFFIX`. A command's flags win over both. `doctor` names any setting it can't read; the built-in defaults apply until you fix it.

## Downloading saved reels

`source download` uses your own yt-dlp. Install it and keep it up to date with `pip install -U yt-dlp`, because Instagram and TikTok break old versions. Instagram needs your login. yt-dlp can read it from your browser, but only if you turn that on in `<data>/config.json`:

```json
{ "download": { "cookiesFromBrowser": "chrome" } }
```

Put a collection's post URLs in `<posts>/saved/<name>/urls.txt`, one per line. To get them, open the collection in the browser, scroll to the end, and copy the links from the developer console. Then run `source download --collection <name>` and `source transcribe --collection <name>`.

You are responsible for following each platform's terms when you download and reuse other people's content.

## Agents

### Claude Code

- **MCP server:** in a clone, `.mcp.json` registers it. With an installed binary, point your client at `shorts-studio mcp serve`. Claude Code asks you once to approve the project's server. The server runs on your machine over stdio, so there is nothing to sign in to. Keys come from your environment or the Keychain. Paid tools (image generation and transcription) ask before every call, and approvals are denied (set in `.claude/settings.json`).
- **Cloudflare MCP:** `.mcp.json` and `.codex/config.toml` also list Cloudflare's MCP server, for the R2 bucket that backs up posts. You only need it if you back up to R2. Sign in once per machine (`/mcp` in Claude Code, `codex mcp login cloudflare` in Codex) and pick the account.
- **Skills:** `.claude/skills/` loads with the project. It is a copy of `.agents/skills/`. `commit`, `pr` and `test-bdd` come from the `ai-standards` plugin marketplace, which `.claude/settings.json` registers. They turn on once you trust the folder.

### Codex

- Open the repository in Codex and mark it as trusted. Only then does Codex read `.codex/config.toml`, which sets up the MCP servers and plugins.
- Run `codex plugin marketplace upgrade` to get `test-bdd`, `commit` and `pr`. If it finds no Git marketplaces, run `codex plugin marketplace add guillempuche/ai-standards` once.
- Skills load from `.agents/skills/`.

### Other tools

Point any MCP client at `bin/shorts-studio mcp serve`, using its absolute path, over stdio. To get the ai-standards skills, run `npx skills add guillempuche/ai-standards --skill <name>` outside the repository.
