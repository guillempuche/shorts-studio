# Daily loop

## Why

Five posts a day only works if the agent can run the whole loop from one skill. The rough edges only show up in real use.

## What Changes

- Improve the `make-shorts` skill from real days of use. Serve it over MCP with the Skills extension.
- An experiment, off by default, that writes CapCut project files. The format is unofficial and may break with new CapCut versions.
- `post copy set` sets the hook, description, hashtags and call to action for each platform.
- `cover render --platform instagram|tiktok|youtube` makes a cover picture with the hook over a chosen draft frame or beat image. It draws the same way as carousel slides: Takumi, a cover layout from the brand's look, fonts from files (see renderer-text-layers and brand-look). Instagram covers keep the hook inside the 3:4 crop the profile grid shows.
- `post sync-note` copies a post's stage into its Obsidian experiment note, only when you run it.

Not part of this change: hosting, accounts for several users.
