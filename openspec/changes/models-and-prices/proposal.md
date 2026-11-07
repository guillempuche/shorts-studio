# Models and prices

## Why

Models change often, and the same job is worth trying with several. Today each provider's models and prices are written in its code, so trying a new model means changing the code. Only images have a price: the ledger can't price voice, music or video, and transcription isn't counted at all.

## What Changes

- **Models are data.** Each provider ships the models it knows. `config.json` can add more under `models`, or change a price. A model names its provider, its endpoint, what it's billed by (megapixel, second, character or minute), its price per unit and the date that price was checked. A new model from a family the provider already handles needs no code.
- `models list` shows each job's models with their prices and when each price was checked. `doctor` warns when a model in use has a price checked more than 90 days ago.
- **Every paid call is priced by its units**, rounded the way the provider bills: images by megapixel, clips by second, voice by character, music and transcription by minute. Each ledger line records the units and the price per unit it used, so old totals stay true after a price changes.
- **Transcription is reserved** like any other paid call.
- **A reservation is freed only when the provider said no.** When the outcome is unknown (the connection dropped, or the command stopped mid-call), the reservation stays counted.
- A provider billed from a plan's credits, like ElevenLabs, is priced at what one unit costs on your plan, set in `config.json`.
- **A monthly cap**, `caps.monthlyUsd` ($100 by default), next to the daily and per-post caps. Days and months follow your local time, not UTC.

Not part of this change: reading the real charge back from providers (none of the current ones report it per call), splitting the ledger by month (one file stays fast for about a year: a reservation takes 170 ms with 36,000 in the ledger), and currencies other than US dollars.
