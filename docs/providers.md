# Providers

Which outside services shorts-studio calls, for what, and what they cost. Key names and where to put them are in [.env.example](../.env.example); `shorts-studio config show` says which keys are set.

| Need           | Provider                                                                                       | Milestone | Notes                                                                                                                                 |
| -------------- | ---------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Transcription  | [Together](https://docs.together.ai/reference/audio-transcriptions), `openai/whisper-large-v3` | 1         | `verbose_json` with word timestamps; uploads up to 80 MB; billed per audio minute                                                     |
| Images         | [FAL](https://fal.ai/models/fal-ai/flux/schnell), `flux-schnell` (default) or `flux-dev`       | 1         | 1248×2224 per image; flux-schnell ≈ $0.003/MP (≈ $0.008 per image), flux-dev ≈ $0.025/MP. Check [FAL pricing](https://fal.ai/pricing) |
| Voice          | Fish Audio, ElevenLabs                                                                         | 3         | Planned: [voice-music-animate](../openspec/changes/voice-music-animate/proposal.md)                                                   |
| Music          | ElevenLabs Music API                                                                           | 3         | Suno has no official API and Fish Audio's music is web-app only: import their tracks with `source import --kind music`                |
| Image to video | FAL                                                                                            | 3         | Only for beats chosen in review                                                                                                       |

## Keys

Environment variables come first. On macOS, a key can instead live in the Keychain under these service names, read with `security`:

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

Every paid call is reserved before it's made and refused when it would pass a cap. Defaults are $5 a day and $2 a post; change them in `<data>/config.json`:

```json
{ "caps": { "dailyUsd": 5, "postUsd": 2 }, "image": { "model": "flux-schnell" } }
```

Costs are estimates from the prices above; providers don't report the actual charge per call.

## Testing without spending

`SHORTS_FAL_URL` and `SHORTS_TOGETHER_URL` point the CLI at stand-ins. `node test/support/fake-fal.ts` starts a local fake of FAL's queue that serves colour cards.
