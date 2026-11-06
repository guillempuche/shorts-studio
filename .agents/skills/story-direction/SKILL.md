---

name: story-direction
description: Direct a short video beat by beat - choose each beat's story moment (hook, setup, tension, twist, vulnerable, payoff, cta), override motion where the image calls for it, and write the hook title and image prompts so pacing, motion and captions serve the story. Use after `beat plan` and before `image generate`, or when a draft feels flat, rushed or monotonous.
compatibility: Claude Code, Codex and other agents in this repository; shorts-studio CLI or MCP tools.
---

# Story direction

How to direct a post's beats. The numbers each choice sets (beat lengths, motion speeds, caption limits) live in [packages/domain/src/direction.ts](../../../packages/domain/src/direction.ts); why, and how strong the evidence is, is in [docs/research](../../../docs/research/README.md). Treat both as starting points: none of the evidence measured 60-second vertical videos.

## The steps

1. `beat plan --post <slug>` and read the transcript beat by beat.
2. Give every beat a **moment** (below), in a `moments.json`: `[{"beat": 0, "moment": "hook"}, …]`, then `beat set --post <slug> --from moments.json`.
3. `beat plan --post <slug> --by-moment` re-cuts each stretch to its moment's beat length. Read the new beats.
4. Write one image prompt per new beat, adding a `motion` only where the default would fight the image (below), and `beat set --from beats.json`.
5. Put a hook title on the script: `script set --post <slug> --file script.md --hook "3 to 7 words"`.
6. After the user approves the script and images exist, `draft render`, then watch it.

## Choosing moments

| Moment       | Use it for                                                          | What it does to the draft  |
| ------------ | ------------------------------------------------------------------- | -------------------------- |
| `hook`       | The first 1–3 s: the claim, question or image that stops the scroll | Short beats, punch-in      |
| `setup`      | Context the viewer needs                                            | Longer beats, slow push    |
| `tension`    | Rising stakes, lists, escalation                                    | Beats shorten, faster push |
| `twist`      | The turn, reveal or surprise                                        | Punch-in, then hold        |
| `vulnerable` | Confession, emotion, the quiet line                                 | Long holds, barely moving  |
| `payoff`     | The lesson, resolution, punchline                                   | Pull back to reveal        |
| `cta`        | Follow, comment, save                                               | One long beat drifting up  |
- **Order:** a typical arc is hook → setup → tension → twist → payoff → cta, with at most one or two vulnerable stretches. Not every post needs every moment.
- **The hook carries the post.** The first frame is seen in a quarter of a second: make beat 0 a clear subject (a face or a person where it fits), and say the core idea by about 2.5 s.
- **Mark stretches, not single beats.** Consecutive beats with one moment form a stretch that `--by-moment` re-cuts as a unit; alternating moments every beat makes noise, not rhythm.
- **Keep fast stretches visually related.** Fast cuts help only between related images (same subject, new framing); a new subject needs a longer beat.

## Overriding motion

Each moment brings a motion; set `motion` on a beat only when the image asks for something else:

- `pan-right` / `pan-left`: a wide scene to explore. Right reads as forward and positive for left-to-right readers; left as setback or memory.
- `drift-up` / `drift-down`: hope or resolution / loss or defeat. Small effects; the image matters more.
- `pull-back`: a detail that should reveal its surroundings.
- `hold`: a strong image or a line that should land without movement. Stillness is what gives motion elsewhere its meaning, so a few holds per post help.

## Prompts that suit the direction

- Leave room for motion: subjects centred with space around them; pans need a wide scene.
- Fast stretches: keep the same subject or palette across consecutive prompts.
- The twist: change scale, palette or composition sharply from the beat before.
- Captions sit in the lower middle of the frame and the hook title near the top: avoid key details there.

## When a draft feels wrong

- **Monotonous:** too few moments, or every beat the same length. Mark the stretches more boldly and re-cut.
- **Rushed:** tension or hook stretches too long. Shorten them in the transcript's terms (fewer beats as hook).
- **Static or drifting:** check the motion overrides; remove most of them.
- Re-cutting drops prompts, so settle the moments before writing prompts.
