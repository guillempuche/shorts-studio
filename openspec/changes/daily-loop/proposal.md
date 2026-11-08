# Daily loop

## Why

Five posts a day only works if the agent can run the whole loop from one skill. The rough edges only show up in real use.

## What Changes

- Improve the `make-shorts` skill from real days of use. Serve it over MCP with the Skills extension.
- An experiment, off by default, that writes CapCut project files. The format is unofficial and may break with new CapCut versions.
- `post copy set` sets the hook, description, hashtags and call to action for each platform.
- `cover render --platform instagram|tiktok|youtube` makes a cover picture with the hook. It draws the same way as carousel slides: Takumi, a cover layout from the brand's look, fonts from files (see renderer-text-layers and brand-look).
  - **The picture under the hook has no text.** `--at <time>` picks a moment of the video. The cover takes that frame from the beat's image at its zoom (`motionAt`) or from the beat's clip, never from `draft.mp4`, whose frames already carry captions and the hook. `--beat N` uses a beat's image as it is.
  - **The hook text** comes from the platform's copy hook (`post copy set`), then the script's hook, then `--text`. With none of them, it refuses and names all three.
  - Instagram covers keep the hook inside the 3:4 crop the profile grid shows.
- `post sync-note` copies a post's stage into its Obsidian experiment note, only when you run it.

Not part of this change: hosting, accounts for several users.
