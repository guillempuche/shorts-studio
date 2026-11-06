# Pacing and cuts

How long each image holds, and where cuts fall. See [README.md](README.md) for the summary and the evidence levels.

## Rules

| Rule                                                                                                                                                                                                 | Evidence                                           | Source                                                                                                                                                                                              |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shots are longest in the setup, near average in the middle, shortest at the start of the climax, and long again in the epilogue (150 films). Conflict gets more cuts; calm and exposition get fewer. | Strong for film; extrapolated to shorts            | [Cutting et al. 2016](https://pmc.ncbi.nlm.nih.gov/articles/PMC5133278/)                                                                                                                            |
| The rhythm is neither even nor random. Neighbouring shot lengths are related and drift in runs (a 1/f pattern).                                                                                      | Moderate (correlational, disputed)                 | [Cutting, DeLong & Nothelfer 2010](https://journals.sagepub.com/doi/abs/10.1177/0956797610361679); [Salt's critique](https://cinemetrics.uchicago.edu/article/590235ff-85aa-4714-9553-71d4c44fd61c) |
| Today's films average about 2–4 s per shot, with action peaks near 1 s. Beats of 1.5–3 s are already at the fast end.                                                                                | Strong (descriptive)                               | [Bordwell, intensified continuity](https://www.davidbordwell.net/blog/2007/05/27/intensified-continuity-revisited/)                                                                                 |
| Fast cutting raises excitement and memory only between related shots. A cut to unrelated content costs about 1 s of extra attention. Fast pacing on intense content overloads viewers.               | Strong (lab, TV)                                   | [Lang et al.](https://www.tandfonline.com/doi/abs/10.1080/08838159909364504)                                                                                                                        |
| Cut on emotion first, where a thought ends. Viewers tend to blink at the same moments at these points.                                                                                               | Lore (Murch's ranking); moderate (blink synchrony) | [Nakano et al. 2009](https://pmc.ncbi.nlm.nih.gov/articles/PMC2817301/)                                                                                                                             |
| The hook window is the first 3 s. Up to 47% of an ad's value came in the first 3 s (Meta/Nielsen). TikTok advises stating the main message in 3 s.                                                   | Moderate to weak (platform ad studies)             | [Meta](https://www.facebook.com/business/news/updated-features-for-video-ads); [TikTok](https://ads.tiktok.com/resources/help/article/creative-best-practices?lang=en)                              |
| People do see the first frame: they recall feed content after seeing it for 0.25 s.                                                                                                                  | Moderate                                           | [Facebook IQ](https://www.facebook.com/business/news/insights/capturing-attention-feed-video-creative)                                                                                              |
| No hard evidence shows that a pause before a punchline helps. Hold the image after the punchline instead.                                                                                            | Contested                                          | [Attardo & Pickering 2011](https://faculty.tamuc.edu/lpickering/Pdfs/Publish_11.pdf)                                                                                                                |

We found no credible published measurement of cut rates in top-performing Shorts or Reels.

## What shorts-studio does with it

Beat length depends on the beat's story moment (`hook`, `setup`, `tension`, `twist`, `vulnerable`, `payoff`, `cta`). Beats are short in the hook and long in setup and vulnerable moments. They get shorter through tension. A twist is followed by a hold. The longest beat comes at the end. Cuts always land on a word or pause boundary. The ranges are in [`packages/domain/src/direction.ts`](../../packages/domain/src/direction.ts).

## Open questions

- Nobody has tested whether act-level film patterns scale down to 60 seconds and about 30 shots.
- Still images with a slow zoom probably carry less motion load than live action. So fast cuts may cost less.
- The hook data measures ad recall, not retention on organic posts.
