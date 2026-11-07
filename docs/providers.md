# Providers

Which outside services shorts-studio calls, what for, and what they cost. `config.json` chooses the provider for each job (`transcribe.provider`, `image.provider`); a fork adds its own in `packages/providers/src/`. [.env.example](../.env.example) lists the key names. `shorts-studio doctor` checks the keys of the providers in use.

| Need           | Provider                                                                                       | Status  | Notes                                                                                                                            |
| -------------- | ---------------------------------------------------------------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Transcription  | [Together](https://docs.together.ai/reference/audio-transcriptions), `openai/whisper-large-v3` | Default | `verbose_json` with word timestamps. Uploads up to 80 MB. Billed per minute of audio                                             |
| Images         | [FAL](https://fal.ai/models/fal-ai/flux/schnell), `flux-schnell` (default) or `flux-dev`       | Default | Each 1344×2400 image is billed as 4 MP: $0.012 with flux-schnell, $0.10 with flux-dev. See [FAL pricing](https://fal.ai/pricing) |
| Voice          | Fish Audio, ElevenLabs                                                                         | Planned | Planned: [voice-music-animate](../openspec/changes/voice-music-animate/proposal.md)                                              |
| Music          | ElevenLabs Music API                                                                           | Planned | Suno has no official API, and Fish Audio's music is only in its web app. Import their tracks with `source import --kind music`   |
| Image to video | FAL                                                                                            | Planned | Only for beats chosen in review                                                                                                  |

## Keys

Environment variables come first. On macOS, a key can live in the Keychain instead, under these service names. shorts-studio reads them with `security`:

| Variable             | Keychain service     |
| -------------------- | -------------------- |
| `TOGETHER_API_KEY`   | `together-api-key`   |
| `FAL_KEY`            | `fal-key`            |
| `ELEVENLABS_API_KEY` | `elevenlabs-api-key` |
| `FISH_API_KEY`       | `fish-audio-key`     |

```bash
security add-generic-password -U -a "$USER" -s fal-key -w
```

## Spending caps

The cost of every paid call is reserved before the call is made. A call that would pass a cap is refused. The defaults are $5 a day and $2 a post. Change them in `config.json` (see [settings](getting-started.md#settings)):

```json
{ "caps": { "dailyUsd": 5, "postUsd": 2 } }
```

Costs are estimates based on the prices above, because providers don't report what each call actually cost.

## Testing without spending

`SHORTS_FAL_URL` and `SHORTS_TOGETHER_URL` point the CLI at fake services. `node packages/providers/src/test/fal-server.ts` starts a local fake of FAL's queue that returns colour cards.

## Adding a provider

Write a layer for the port in `packages/providers/src/` (see `fal.ts` and `together.ts`), add one line for it in `packages/providers/src/index.ts`, and choose it in `config.json`. Its test file runs the shared contract for that port (`imageMakerContract` or `transcriberContract` in `packages/usecases/src/test/`) against a local fake of the service, so it behaves like every other provider: the same errors, a resumable request, and its key checked before anything is paid.
