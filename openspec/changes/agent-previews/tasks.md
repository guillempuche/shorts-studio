# Tasks

## 1. Previews

- [ ] 1.1 `preview --at`: a frame from `motionAt` and `textAt`, drawn by Takumi
- [ ] 1.2 Compare previews with the same frames of a rendered draft; record the largest difference
- [ ] 1.3 `preview --slide`, `--cover` and `--sheet`, with numbers and times on the sheet
- [ ] 1.4 Sizes: 540 px wide by default, sheets at most 1568 px, `--full`; the `previews/` folder, deleted by `post archive`
- [ ] 1.5 Over MCP, return the picture through `McpServer.addTool`; on the CLI, print the path

## 2. Problems as data

- [ ] 2.1 One problem shape in the domain, used by every check
- [ ] 2.2 `draft check`: reading limits, safe zones, beats without images, captions across a beat change
- [ ] 2.3 `carousel check` and `layout check` use the same shape

## 3. Fixes

- [ ] 3.1 `caption fix --word N --text`, keeping the word's timing
- [ ] 3.2 `caption break --after-word N`, within the reading limits
- [ ] 3.3 Fixes stored apart from the transcript; dropped and reported when it changes
- [ ] 3.4 `slide set --slide N`
- [ ] 3.5 The make-shorts skill: preview, check, fix, then render
