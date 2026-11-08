## ADDED Requirements

### Requirement: Previews SHALL show one picture without rendering the draft

`preview` SHALL draw one frame, slide, cover or sheet without rendering the draft. Over MCP it SHALL return the picture as image content together with its path. On the CLI it SHALL print the path. Pictures SHALL be 540 px wide unless `--full` is given, and sheets at most 1568 px on their longest side.

#### Scenario: An agent checks one frame

- **WHEN** an MCP client calls `preview` for 12.3 s of a post
- **THEN** the result holds a 540×960 picture of that frame and its path
- **AND** no draft is rendered

### Requirement: Checks SHALL report problems in one shape

`draft check`, `carousel check` and `layout check` SHALL report every problem they find as one item each, with where it is, what is wrong, by how much and in what unit. They SHALL exit 1 when there is a problem and 0 when there is none.

#### Scenario: A long caption

- **WHEN** caption 12 is 6 characters over its limit
- **THEN** `draft check --json` lists `{where: "caption 12", what: "too many characters", amount: 6, unit: "characters"}`
- **AND** it exits 1
