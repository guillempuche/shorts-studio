# Pacing and cuts

How long each image holds, and where cuts fall. Summary and evidence levels are explained in [README.md](README.md).

## Rules

| Rule                                                                                                                                                                                                     | Evidence                                           | Source                                                                                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shots are longest in the setup, near average in the middle, shortest at the start of the climax, and long again in the epilogue (150 films). More cuts go with conflict, fewer with calm and exposition. | Strong for film; extrapolated to shorts            | [Cutting et al. 2016](https://pmc.ncbi.nlm.nih.gov/articles/PMC5133278/)                                                                                                                            |
| Neither a uniform rhythm nor random jitter: neighbouring shot lengths correlate, drifting in runs (1/f pattern).                                                                                         | Moderate (correlational, disputed)                 | [Cutting, DeLong & Nothelfer 2010](https://journals.sagepub.com/doi/abs/10.1177/0956797610361679); [Salt's critique](https://cinemetrics.uchicago.edu/article/590235ff-85aa-4714-9553-71d4c44fd61c) |
| Contemporary films average about 2–4 s per shot, with action peaks near 1 s. Beats of 1.5–3 s are already at the fast end.                                                                               | Strong (descriptive)                               | [Bordwell, intensified continuity](https://www.davidbordwell.net/blog/2007/05/27/intensified-continuity-revisited/)                                                                                 |
| Fast cutting raises arousal and memory only between related shots; a cut to unrelated content costs about 1 s of extra attention, and fast pacing on arousing content overloads viewers.                 | Strong (lab, TV)                                   | [Lang et al.](https://www.tandfonline.com/doi/abs/10.1080/08838159909364504)                                                                                                                        |
| Cut on emotion first, where a thought completes; viewers' blinks synchronise at such breakpoints.                                                                                                        | Lore (Murch's ranking); moderate (blink synchrony) | [Nakano et al. 2009](https://pmc.ncbi.nlm.nih.gov/articles/PMC2817301/)                                                                                                                             |
| The hook window is the first 3 s: up to 47% of an ad's value came in the first 3 s (Meta/Nielsen); TikTok advises stating the proposition in 3 s.                                                        | Moderate to weak (platform ad studies)             | [Meta](https://www.facebook.com/business/news/updated-features-for-video-ads); [TikTok](https://ads.tiktok.com/resources/help/article/creative-best-practices?lang=en)                              |
| The first frame is seen: feed content is recalled after 0.25 s of exposure.                                                                                                                              | Moderate                                           | [Facebook IQ](https://www.facebook.com/business/news/insights/capturing-attention-feed-video-creative)                                                                                              |
| No hard evidence that a pause before a punchline helps; hold the image after it instead.                                                                                                                 | Contested                                          | [Attardo & Pickering 2011](https://faculty.tamuc.edu/lpickering/Pdfs/Publish_11.pdf)                                                                                                                |

No credible published measurement of cut rates in top-performing Shorts or Reels was found.

## What shorts-studio does with it

Beat length depends on the beat's story moment (`hook`, `setup`, `tension`, `twist`, `vulnerable`, `payoff`, `cta`): short in the hook, long in setup and vulnerable moments, shrinking through tension, a hold after a twist, the longest beat at the end. Cuts stay at word and pause boundaries. The ranges are in [`src/domain/direction.ts`](../../src/domain/direction.ts).

## Open questions

- Whether act-level film patterns scale down to 60 seconds and about 30 shots is untested.
- Still images with a slow zoom probably carry less motion load than live action, so fast cuts may cost less.
- Hook data measures ad recall, not organic retention.
