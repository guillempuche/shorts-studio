# Getting started

How to set up a machine to run shorts-studio, and how to connect Claude Code or Codex to it.

## Install

Pick one option from the [README's install table](../README.md#install). Nix is the easiest on macOS and Linux. It brings an FFmpeg built with libass, which captions need. Many FFmpeg builds lack libass, Homebrew's included. With the binary or npm, install FFmpeg yourself and check that `ffmpeg -filters` lists `subtitles`.

## From source

`nix develop` gives you Node 24, ffmpeg-full and OpenSpec. With direnv, `.envrc` enters that shell when you `cd` into the folder and puts `bin/` on your PATH. Then run `pnpm install` and use `bin/shorts-studio`. Outside the Nix shell, an older corepack may fail to start pnpm 12.

## Keys and folders

1. Set `TOGETHER_API_KEY` and `FAL_KEY` (see [providers](providers.md#keys)).
2. By default, posts go in your system's application-data folder. To choose another place, set `SHORTS_POSTS_DIR` (and `SHORTS_DATA_DIR`) in your shell profile.
3. `shorts-studio doctor` should end with `Ready.`

## Downloading saved reels

`source download` uses your own yt-dlp. Install it and keep it up to date with `pip install -U yt-dlp`, because Instagram and TikTok break old versions. Instagram needs your login. yt-dlp can read it from your browser, but only if you turn that on in `<data>/config.json`:

```json
{ "download": { "cookiesFromBrowser": "chrome" } }
```

Put a collection's post URLs in `<posts>/saved/<name>/urls.txt`, one per line. To get them, open the collection in the browser, scroll to the end, and copy the links from the developer console. Then run `source download --collection <name>` and `source transcribe --collection <name>`. To bring in folders from the old `ig-saved.sh`, run `source adopt --from <folder> --collection <name>`.

You are responsible for following each platform's terms when you download and reuse other people's content.

## Agents

### Claude Code

- **MCP server:** in a clone, `.mcp.json` registers it. With an installed binary, point your client at `shorts-studio mcp serve`. Claude Code asks you once to approve the project's server. The server runs on your machine over stdio, so there is nothing to sign in to. Keys come from your environment or the Keychain. Paid tools ask before every call (set in `.claude/settings.json`).
- **Cloudflare MCP:** `.mcp.json` and `.codex/config.toml` also list Cloudflare's MCP server, for the R2 bucket that backs up posts. You only need it if you back up to R2. Sign in once per machine (`/mcp` in Claude Code, `codex mcp login cloudflare` in Codex) and pick the account.
- **Skills:** `.claude/skills/` loads with the project. It is a copy of `.agents/skills/`. `commit`, `pr` and `test-bdd` come from the `ai-standards` plugin marketplace, which `.claude/settings.json` registers. They turn on once you trust the folder.

### Codex

- Open the repository in Codex and mark it as trusted. Only then does Codex read `.codex/config.toml`, which sets up the MCP servers and plugins.
- Run `codex plugin marketplace upgrade` to get `test-bdd`, `commit` and `pr`. If it finds no Git marketplaces, run `codex plugin marketplace add guillempuche/ai-standards` once.
- Skills load from `.agents/skills/`.

### Other tools

Point any MCP client at `bin/shorts-studio mcp serve`, using its absolute path, over stdio. To get the ai-standards skills, run `npx skills add guillempuche/ai-standards --skill <name>` outside the repository.
