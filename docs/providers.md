# Providers

Which outside services shorts-studio calls, what for, and what they cost. `config.json` chooses the provider for each job (`transcribe.provider`, `image.provider`); a fork adds its own in `packages/providers/src/`. [.env.example](../.env.example) lists the key names. `shorts-studio doctor` checks the keys of the providers in use.

| Need           | Provider                                                                                       | Status  | Notes                                                                                                                          |
| -------------- | ---------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Transcription  | [Together](https://docs.together.ai/reference/audio-transcriptions), `openai/whisper-large-v3` | Default | `verbose_json` with word timestamps. Uploads up to 80 MB. Billed per minute of audio                                           |
| Images         | [FAL](https://fal.ai/models/fal-ai/flux/schnell), `flux-schnell` (default) or `flux-dev`       | Default | Billed per megapixel, rounded up: each 1344×2400 image counts as 4 MP. `models list` shows the prices                          |
| Voice          | Fish Audio, ElevenLabs                                                                         | Planned | Planned: [voice-music-animate](../openspec/changes/voice-music-animate/proposal.md)                                            |
| Music          | ElevenLabs Music API                                                                           | Planned | Suno has no official API, and Fish Audio's music is only in its web app. Import their tracks with `source import --kind music` |
| Image to video | FAL                                                                                            | Planned | Only for beats chosen in review                                                                                                |

## Models and prices

Each provider ships the models it knows, each with its price per unit and the day that price was checked. `shorts-studio models list` shows them, the model each job uses, and how old each price is. `doctor` warns when the price in use was checked more than 90 days ago.

Every paid call is priced from these: its units times the price of one, rounded the way the provider bills. Images count by megapixel or by image, and transcription by the minute of audio. Each ledger line keeps the units and the price it used, so a later price change doesn't move past totals.

To change a price, or to add a model from a family a provider already handles, set it under `models` in `config.json`. A provider's own model only needs what changes:

```json
{ "models": { "flux-dev": { "usdPerUnit": 0.03, "priceChecked": "2026-12-01" } } }
```

A new model needs every field. Check its price on the provider's page; the one below is only an example:

```json
{
  "models": {
    "flux-pro": {
      "provider": "fal",
      "job": "image",
      "endpoint": "fal-ai/flux-pro/v1.1",
      "billedBy": "megapixel",
      "usdPerUnit": 0.04,
      "roundUp": true,
      "priceChecked": "2026-11-07",
      "options": { "safety_tolerance": "2" }
    }
  }
}
```

Use it once with `image generate --model flux-pro`, or for every post with `image.model`. `options` are fields sent with every request. They can't change the image size, count, seed or prompt that the estimate was made for. Models are set in `config.json` only: their names don't fit in environment variable names. `doctor` warns about a model there that no provider in use claims, which is often a misspelt name.

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

The cost of every paid call, transcription included, is reserved before the call is made. A call that would pass a cap is refused, naming the cap: the post's first, then the month's, then the day's. The defaults are $5 a day, $100 a month and $2 a post. Change them in `config.json` (see [settings](getting-started.md#settings)):

```json
{ "caps": { "dailyUsd": 5, "monthlyUsd": 100, "postUsd": 2 } }
```

Days and months follow the machine's time zone, so a call at 00:30 counts toward the new day. `TZ` sets the zone in any of its forms: `Europe/Madrid`, `:Europe/Madrid`, or `:/etc/localtime` for the machine's own. A `TZ` that names no zone falls back to UTC, and `doctor` warns.

A reservation is freed only when nothing was billed: the provider refused the request (an HTTP 4xx) or reported the job failed, or the call stopped before anything was sent. When the outcome is unknown, such as after a 5xx, a dropped connection or a run stopped mid-call, it stays counted.

Costs are estimates from the prices in `models list`, because providers don't report what each call actually cost.

## Testing without spending

`SHORTS_FAL_URL` and `SHORTS_TOGETHER_URL` point the CLI at fake services. `node packages/providers/src/test/fal-server.ts` starts a local fake of FAL's queue that returns colour cards.

## Adding a provider

Write a layer for the port in `packages/providers/src/` (see `fal.ts` and `together.ts`), add one line for it in `packages/providers/src/index.ts`, and choose it in `config.json`. Its test file runs the shared contract for that port (`imageMakerContract` or `transcriberContract` in `packages/usecases/src/test/`) against a local fake of the service, so it behaves like every other provider: the same errors, a resumable request, and its key checked before anything is paid.
