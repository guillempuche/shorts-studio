# Workspace and swappable providers

## Why

shorts-studio should be easy to fork. Someone else may want other voices, other image models or another transcription service. Today the commands call FAL and Together directly, and all the code sits in one package, so nothing stops the story rules from depending on a provider.

## What Changes

- **Workspace.** The code moves into `apps/` and `packages/`, like Batuda, with Turbo and syncpack:
  - `apps/cli` and `apps/mcp`: the two ways in.
  - `packages/domain`: the post, beats, story moments and their rules. No files, no network.
  - `packages/usecases`: one use case per command, and the ports (the jobs a provider can do).
  - `packages/providers`: FAL, Together, ElevenLabs, Fish Audio, ffmpeg, yt-dlp and the file system.
  - `packages/tsconfig`: shared, strict TypeScript settings.
- **Node 26** in the Nix shell, the Nix package, CI and `engines`.
- **Providers are ports.** Each job (transcribe, make an image, speak, make music, animate a clip) is an Effect service. Each provider is a layer that does one or more jobs, declares its models, prices and key, and passes a shared test suite.
- **Settings in layers:** built-in defaults, then `config.json` and `brand.json`, then `SHORTS_*` environment variables, then flags. Both files have a published JSON Schema for editor autocompletion.
- **Keys** come only from the environment or the OS keychain, read as redacted values so they never reach logs.
- `doctor` checks only the keys of the providers in use.

Not part of this change: new providers beyond the four above, voice and music commands (in voice-music-animate), a GUI.
