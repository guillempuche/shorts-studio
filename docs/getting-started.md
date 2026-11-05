# Getting started

Setting up a machine to run shorts-studio, and connecting Claude Code or Codex to it.

## Machine

1. **Nix (recommended).** `nix develop` gives Node 24, an FFmpeg built with libass, and OpenSpec. Without Nix, install Node 24+ and an FFmpeg whose `ffmpeg -filters` lists `subtitles`; minimal builds (Homebrew's included) don't, and captions then fail.
2. **direnv (optional)** enters the shell on `cd` and puts `bin/` on your PATH: `brew install direnv`, hook it into your shell, then `direnv allow` in the repository.
3. **Dependencies:** `pnpm install` inside the shell. pnpm comes from corepack at the version `package.json` names; outside the Nix shell an older corepack may fail to start it.
4. **Keys:** set `TOGETHER_API_KEY` and `FAL_KEY` (see [providers](providers.md#keys)).
5. **Where your posts go:** by default under your OS's application-data folder; set `SHORTS_POSTS_DIR` (and `SHORTS_DATA_DIR`) in your shell profile to choose.
6. **Check:** `shorts-studio config show` should end with `Ready.`

## Downloading saved reels

`source download` uses your own yt-dlp; install it and keep it current (`pip install -U yt-dlp`: Instagram and TikTok break old versions). Instagram needs your login, which yt-dlp can read from your browser; that's opt-in, in `<data>/config.json`:

```json
{ "download": { "cookiesFromBrowser": "chrome" } }
```

Put the post URLs of a collection in `<posts>/saved/<name>/urls.txt`, one per line (in the browser, open the collection, scroll to the end, and copy the links from the developer console). Then `source download --collection <name>` and `source transcribe --collection <name>`. Folders from the old `ig-saved.sh` come in with `source adopt --from <folder> --collection <name>`. Downloading and reusing others' content is your responsibility under each platform's terms.

## Agents

### Claude Code

- **MCP server:** `.mcp.json` registers it; Claude Code asks once to approve the project's server. It runs locally over stdio, so there is nothing to sign in to; keys come from your environment or Keychain. Paid tools ask before every call (`.claude/settings.json`).
- **Skills:** `.claude/skills/` (a copy of `.agents/skills/`) loads with the project. `commit`, `pr` and `test-bdd` come from the `ai-standards` plugin marketplace that `.claude/settings.json` registers; trust the folder and they turn on.

### Codex

- Open the repository in Codex and mark it trusted; Codex reads `.codex/config.toml` (the MCP server and plugins) only then.
- Run `codex plugin marketplace upgrade` for `test-bdd`, `commit` and `pr` (if it finds no Git marketplaces, `codex plugin marketplace add guillempuche/ai-standards` once).
- Skills load from `.agents/skills/`.

### Other tools

Point any MCP client at `bin/shorts-studio mcp serve` (absolute path, stdio). For the ai-standards skills: `npx skills add guillempuche/ai-standards --skill <name>`, run outside the repository.
