## ADDED Requirements

### Requirement: Font downloads SHALL stay on the CLI

`font add --google` SHALL be CLI-only. It SHALL download each weight of the family once into the data folder's `fonts/`. Nothing else SHALL download fonts.

#### Scenario: An agent over MCP

- **WHEN** an MCP client lists the tools
- **THEN** there is no tool that downloads fonts

### Requirement: The setup check SHALL name missing fonts

`doctor` SHALL fail with code `missing-tool` when `brand.json` names a font family that isn't in `fonts/` or shipped, naming the family and how to add it.

#### Scenario: A font named but not added

- **WHEN** `brand.json` names the family "Lora" and `fonts/` has no Lora file
- **THEN** `doctor` exits 1
- **AND** its fix is `font add --google Lora` or `font add --file`

### Requirement: A fork's layouts SHALL be checked before use

`layout check --name <layout>` SHALL draw the layout with sample text at every size it supports and run the fit check, reporting every text box that overflows.

#### Scenario: A layout whose box is too small

- **WHEN** a fork's layout has a title box too short for two lines
- **THEN** `layout check` exits 1
- **AND** it names the box and by how many pixels it overflows
