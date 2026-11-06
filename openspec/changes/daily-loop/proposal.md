# Daily loop

## Why

Five posts a day only works if the agent can run the whole loop from one skill. The rough edges only show up in real use.

## What Changes

- Improve the `make-shorts` skill from real days of use. Serve it over MCP with the Skills extension.
- An experiment, off by default, that writes CapCut project files. The format is unofficial and may break with new CapCut versions.
- `post copy set` sets the hook, description, hashtags and call to action for each platform. `cover render` makes a cover frame with the hook.
- `post sync-note` copies a post's stage into its Obsidian experiment note, only when you run it.

Not part of this change: hosting, accounts for several users.
