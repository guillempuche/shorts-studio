# Getting started

Setting up a machine to run shorts-studio, and connecting Claude Code or Codex to it.

## Install

Pick one from the [README's install table](../README.md#install). Nix is the easiest on macOS and Linux: it brings an FFmpeg built with libass, which captions need and many builds (Homebrew's included) lack. With the binary or npm, install FFmpeg yourself and check `ffmpeg -filters` lists `subtitles`.

## From source

`nix develop` gives Node 24, ffmpeg-full and OpenSpec (direnv with `.envrc` enters it on `cd` and puts `bin/` on your PATH); then `pnpm install` and use `bin/shorts-studio`. Outside the Nix shell an older corepack may fail to start pnpm 12.

## Keys and folders

1. Set `TOGETHER_API_KEY` and `FAL_KEY` (see [providers](providers.md#keys)).
2. Posts go under your OS's application-data folder by default; set `SHORTS_POSTS_DIR` (and `SHORTS_DATA_DIR`) in your shell profile to choose.
3. `shorts-studio doctor` should end with `Ready.`

## Downloading saved reels

`source download` uses your own yt-dlp; install it and keep it current (`pip install -U yt-dlp`: Instagram and TikTok break old versions). Instagram needs your login, which yt-dlp can read from your browser; that's opt-in, in `<data>/config.json`:

```json
{ "download": { "cookiesFromBrowser": "chrome" } }
```

Put the post URLs of a collection in `<posts>/saved/<name>/urls.txt`, one per line (in the browser, open the collection, scroll to the end, and copy the links from the developer console). Then `source download --collection <name>` and `source transcribe --collection <name>`. Folders from the old `ig-saved.sh` come in with `source adopt --from <folder> --collection <name>`. Downloading and reusing others' content is your responsibility under each platform's terms.

## Agents

### Claude Code

- **MCP server:** `.mcp.json` registers it (from a clone; with an installed binary, point your client at `shorts-studio mcp serve`); Claude Code asks once to approve the project's server. It runs locally over stdio, so there is nothing to sign in to; keys come from your environment or Keychain. Paid tools ask before every call (`.claude/settings.json`).
- **Skills:** `.claude/skills/` (a copy of `.agents/skills/`) loads with the project. `commit`, `pr` and `test-bdd` come from the `ai-standards` plugin marketplace that `.claude/settings.json` registers; trust the folder and they turn on.

### Codex

- Open the repository in Codex and mark it trusted; Codex reads `.codex/config.toml` (the MCP server and plugins) only then.
- Run `codex plugin marketplace upgrade` for `test-bdd`, `commit` and `pr` (if it finds no Git marketplaces, `codex plugin marketplace add guillempuche/ai-standards` once).
- Skills load from `.agents/skills/`.

### Other tools

Point any MCP client at `bin/shorts-studio mcp serve` (absolute path, stdio). For the ai-standards skills: `npx skills add guillempuche/ai-standards --skill <name>`, run outside the repository.
