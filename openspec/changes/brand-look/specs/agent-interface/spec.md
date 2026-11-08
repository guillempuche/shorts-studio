## ADDED Requirements

### Requirement: Font downloads SHALL stay on the CLI

`font add --google` SHALL be CLI-only. It SHALL download each weight of the family once into the data folder's `fonts/`, writing each file whole or not at all. Nothing else SHALL download fonts.

#### Scenario: An agent over MCP

- **WHEN** an MCP client lists the tools
- **THEN** there is no tool that downloads fonts

#### Scenario: The network drops halfway

- **WHEN** the download of a family stops after two of its four weights
- **THEN** `font add` exits 1
- **AND** `fonts/` has no partial file

### Requirement: Adding a font SHALL keep fonts/ consistent

`font add --file` SHALL refuse a file that isn't a font, and SHALL refuse a family and weight that `fonts/` already has unless `--replace` is given.

#### Scenario: The same weight twice

- **WHEN** `fonts/` has Lora 700 and another Lora 700 file is added without `--replace`
- **THEN** `font add` exits 2
- **AND** the error names the file already there

### Requirement: The setup check SHALL name missing fonts

`doctor` SHALL fail with code `missing-tool` when `brand.json` names a font family that isn't in `fonts/` or shipped, naming the family and how to add it. When `brand.json`'s `look` and `config.json`'s old `captions.*` keys both set a value, `doctor` SHALL warn that `look` wins.

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
