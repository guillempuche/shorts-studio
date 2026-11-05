# Sound and rhythm

Cutting to music, voice speed, pauses, and mixing. Summary and evidence levels are explained in [README.md](README.md). Most of this applies when voice and music generation arrive ([voice-music-animate](../../openspec/changes/voice-music-animate/proposal.md)).

## Rules

| Rule                                                                                                                                                         | Evidence                 | Source                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Images shown on a regular musical beat are remembered better than images shown off it.                                                                       | Moderate (lab)           | [Johndro et al. 2019](https://www.sciencedirect.com/science/article/abs/pii/S0001691819300149)                                                                                         |
| Sound ahead of picture is noticed from about 45 ms, behind picture from about 125 ms: put a cut on the beat or one frame early, never late.                  | Strong (ITU-R BT.1359)   | [ITU-R BT.1359](https://www.itu.int/dms_pubrec/itu-r/rec/bt/R-REC-BT.1359-0-199802-S!!PDF-E.pdf)                                                                                       |
| Engagement peaks at musical section boundaries and climaxes.                                                                                                 | Moderate (concert music) | [NYAS 2025](https://nyaspubs.onlinelibrary.wiley.com/doi/full/10.1111/nyas.15279)                                                                                                      |
| Faster tempo raises arousal; major mode reads positive, minor negative; fast-major and slow-minor are liked more than mismatches.                            | Strong                   | [Hunter & Schellenberg review](https://pmc.ncbi.nlm.nih.gov/articles/PMC3726864/)                                                                                                      |
| Preferred tempo is about 100–120 BPM.                                                                                                                        | Moderate                 | [Moelants and later work](https://pmc.ncbi.nlm.nih.gov/articles/PMC5987030/)                                                                                                           |
| Speaking rate around 150–170 words per minute; Spanish tolerates faster (170–190), easy-language Catalan slower (150). Comprehension drops sharply near 315. | Strong                   | [Rodero](https://www.sciencedirect.com/science/article/pii/S0271530925000709); [PubMed 34516216](https://pubmed.ncbi.nlm.nih.gov/34516216/)                                            |
| A silent pause improves memory for the word after it.                                                                                                        | Moderate                 | [MacGregor et al. 2010](https://www.sciencedirect.com/science/article/abs/pii/S0028393210004148)                                                                                       |
| Keep music at least 10 LU under speech (15 under ambience); ordinary listeners like more music than engineers.                                               | Strong                   | [Torcoli et al. 2019](https://salford-repository.worktribe.com/output/1360952/preferred-levels-for-background-ducking-to-produce-esthetically-pleasing-audio-for-tv-with-clear-speech) |
| Master to about −14 LUFS integrated, −1 dBTP; only YouTube's normalisation is observable, TikTok and Instagram publish no target.                            | Weak to moderate         | [Loudness overview](https://apu.software/tiktok-instagram-reels-loudness/)                                                                                                             |
| Instagram favours reels whose audio page viewers open, and demotes muted or reposted reels.                                                                  | Strong (official)        | [Instagram ranking explained](https://about.instagram.com/blog/announcements/instagram-ranking-explained)                                                                              |
| Whooshes and hits on cuts are widely used, with no evidence they change perceived pace.                                                                      | Lore                     |                                                                                                                                                                                        |

**Muted viewing** figures conflict: 85% muted (Facebook feed, 2016, publisher-reported), 69% muted in public (Verizon/Publicis survey, 2019), 80% of Reels with sound on (Instagram, 2022). Captions stay on for accessibility and noisy places; "most people watch muted" isn't supported for Reels or TikTok today.

## What shorts-studio will do with it

Music beats cut every 2, 4 or 8 musical beats so each image lasts about 2–2.5 s, snapped to downbeats and never late, with forced cuts at section changes and drops. Speech over music keeps word boundaries and snaps to a beat only within ±120 ms. Voices default to about 160 words per minute, faster on hooks, slower on reflective lines. Music sits 12 LU under the voice and the mix targets −14 LUFS. Numbers will live in [`src/domain/direction.ts`](../../src/domain/direction.ts).

## Open questions

- No study shows beat-synced cuts raise retention or shares on the platforms.
- How many beats per cut, and whether syncopation helps, has no data.
- Trending-audio tempo distributions aren't published.
