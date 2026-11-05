# Text and captions

Reading speed, caption grouping, highlighting, emphasis, placement and the hook title. Summary and evidence levels are explained in [README.md](README.md).

## Rules

| Rule                                                                                                                                                                                                                              | Evidence                           | Source                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reading-speed caps: 160–180 words per minute (BBC), 20 characters per second for adults and 17 for children (Netflix).                                                                                                            | Strong (standards)                 | [BBC subtitle guidelines](https://www.bbc.co.uk/accessibility/forproducts/guides/subtitles/); [Netflix](https://partnerhelp.netflixstudios.com/hc/en-us/articles/217350977)            |
| Each caption stays up at least about 5/6 s (Netflix) to 1.33 s (DCMP), at most 6–7 s.                                                                                                                                             | Strong                             | [Netflix timing](https://partnerhelp.netflixstudios.com/hc/en-us/articles/215758617); [DCMP](https://dcmp.org/learn/597-captioning-key---text)                                         |
| In vertical video, lines of about 25 characters, at most 2–3 lines.                                                                                                                                                               | Strong (BBC, extrapolated to 9:16) | BBC as above                                                                                                                                                                           |
| One word alone on screen hurts comprehension (60% vs 72%) and tires viewers.                                                                                                                                                      | Moderate                           | [Spritz study](https://tsw.it/wp-content/uploads/Rapid-serial-visual-presentation-in-reading-The-case-of-Spritz-1.pdf); [ACM MUM 2024](https://dl.acm.org/doi/10.1145/3701571.3701574) |
| Word-by-word highlight inside a full phrase helps reading in literacy studies, but viewers preferred plain captions for entertainment; comprehension was similar.                                                                 | Moderate                           | [Same Language Subtitling](https://pmc.ncbi.nlm.nih.gov/articles/PMC10615567); ACM MUM 2024                                                                                            |
| Signalling key words helps retention (meta-analysis of 103 studies), only when cues are sparse.                                                                                                                                   | Strong for learning media          | [Schneider et al. 2018](https://www.sciencedirect.com/science/article/abs/pii/S1747938X17300581)                                                                                       |
| Kinetic typography's effect on recall is asserted more than measured.                                                                                                                                                             | Weak                               | [2023 review](https://www.nature.com/articles/s41599-023-01646-6)                                                                                                                      |
| No more than 3 flashes per second.                                                                                                                                                                                                | Strong                             | [WCAG 2.3.1](https://www.w3.org/WAI/WCAG21/Understanding/three-flashes-or-below-threshold.html)                                                                                        |
| Safe zones in 1080×1920: Reels keeps the top 14% (269 px) and bottom 35% (672 px) clear; TikTok ads about 240 px top and 660 px bottom; Shorts about 380 px top and bottom; keep about 120–140 px clear on the right for buttons. | Moderate (template readings)       | [Meta](https://www.facebook.com/business/help/980593475366490); [Shorts checker](https://www.poster.ly/tools/youtube-shorts-safe-zone-checker)                                         |
| A bold title or question in the first 3 s raises recall in platform ad studies.                                                                                                                                                   | Moderate                           | [TikTok creative best practices](https://ads.tiktok.com/resources/help/article/creative-best-practices)                                                                                |

TikTok's ad advice of "5–10 words per second" of on-screen text contradicts every reading standard and is ignored here.

## What shorts-studio does with it

- Captions group at most 4 words, about 42 characters (two lines of 25) and 17 characters per second, stay up at least 0.8 s by extending into the following pause, and never leave one word alone except at the very end.
- Captions sit centred around y≈1100, clear of every platform's bottom zone and the right-hand buttons.
- Word-by-word highlight is an option (`captions.highlight` in config.json), off by default.
- An optional hook title of 3–7 words shows in the upper safe band for the first seconds (`script set --hook`).

Numbers are in [`src/domain/direction.ts`](../../src/domain/direction.ts).

## Open questions

- No public A/B data compares highlighted and plain captions on short-form retention.
- Safe-zone pixels come from third-party readings of templates and change with app updates.
