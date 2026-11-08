## ADDED Requirements

### Requirement: Previews SHALL show one picture without rendering the draft

`preview` SHALL draw one frame, slide, cover or sheet without rendering the draft, with the draft's own text renderer. Over MCP it SHALL return the picture as image content together with its path; on the CLI it SHALL print the path. Pictures SHALL be 540 px wide unless `--full` is given, and sheets at most 1568 px on their longest side.

#### Scenario: An agent checks one frame

- **WHEN** an MCP client calls `preview` for 12.3 s of a post
- **THEN** the result holds a 540×960 picture of that frame and its path
- **AND** no draft is rendered

#### Scenario: A frame inside a clip beat

- **WHEN** 12.3 s falls in beat 4, which has a clip
- **THEN** the picture shows the clip's frame at that moment, with the text over it

#### Scenario: A time past the end

- **WHEN** `preview --at 90` runs on a 66 s post
- **THEN** it exits 2
- **AND** the error names the range 0 to 66 s

### Requirement: An operation with a picture SHALL still be defined once

An operation whose output includes a picture SHALL be defined once in the operation list, like every other. The MCP server SHALL register it so its result can carry the picture, and `schema show` SHALL describe its output.

#### Scenario: Listing the tools

- **WHEN** an MCP client lists the tools
- **THEN** `preview` is listed with the same parameters as the CLI's `preview`

### Requirement: Checks SHALL report problems in one shape

`draft check`, `carousel check` and `layout check` SHALL report every problem as one item, with where it is, what is wrong, by how much and in what unit. Captions SHALL be named by their word range and start time, numbered from 0. They SHALL exit 1 when there is a problem and 0 when there is none.

#### Scenario: A long caption

- **WHEN** the caption of words 41–44, at 12.4 s, is 6 characters over its limit
- **THEN** `draft check --json` lists `{where: "words 41–44 (0:12.4)", what: "too many characters", amount: 6, unit: "characters"}`
- **AND** it exits 1

#### Scenario: Emoji with ASS

- **WHEN** the hook has 🔥 and `render.text` is `ass`
- **THEN** `draft check` reports the hook's emoji as something ASS can't draw
