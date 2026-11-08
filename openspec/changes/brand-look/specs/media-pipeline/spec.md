## ADDED Requirements

### Requirement: Text SHALL be drawn only with font files

Text drawn by Takumi (captions, slides, covers, previews) SHALL use fonts loaded from files: the data folder's `fonts/` or the fonts shipped with shorts-studio. A font that isn't there SHALL never be looked up by name on the system or downloaded while drawing. Missing letters SHALL fall back through the brand's fonts, then the shipped ones.

#### Scenario: Another machine

- **WHEN** the same post is drawn on two machines with the same `fonts/` and `brand.json`
- **THEN** both use the same font files

#### Scenario: A missing letter

- **WHEN** the brand's font has no Japanese letters and a caption is in Japanese
- **THEN** the caption uses the next font in the fallback list that has them

### Requirement: A named font SHALL have a file or stop the drawing

When a valid `brand.json` names a font family that has no file in `fonts/` or among the shipped fonts, every command that draws text SHALL fail with code `missing-tool`, naming the family and `font add`. With `render.text` set to `ass`, the caption family SHALL need a file too.

#### Scenario: A font named but not added

- **WHEN** `brand.json` names "Lora" for titles and there is no Lora file
- **THEN** `carousel render` exits 1 with code `missing-tool`
- **AND** nothing is drawn in another font

### Requirement: The shipped font SHALL be the default

When neither `brand.json` nor `config.json` names a caption font, captions SHALL use the shipped Inter with both renderers.

#### Scenario: A fresh install

- **WHEN** no caption font is set and a draft is rendered with `ass`
- **THEN** the captions are drawn in Inter from the shipped file

### Requirement: Text SHALL use a layout from a fixed list

Every caption style, slide and cover SHALL name a layout from the shipped list or from the data folder's `layouts/`. Each layout SHALL declare its text boxes. Commands SHALL refuse a layout name that isn't known, and a layout in `layouts/` SHALL NOT reuse a shipped layout's name.

#### Scenario: An unknown layout

- **WHEN** a slide names the layout `photo-left`, which doesn't exist
- **THEN** `carousel set` exits 2
- **AND** the error lists the layouts there are
