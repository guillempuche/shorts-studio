## ADDED Requirements

### Requirement: Text SHALL be drawn only with font files

Captions, slides and covers SHALL be drawn with fonts loaded from files: the data folder's `fonts/` or the fonts shipped with shorts-studio. A font that isn't there SHALL never be looked up by name on the system or downloaded while drawing.

#### Scenario: Another machine

- **WHEN** the same post is drawn on two machines with the same `fonts/` and `brand.json`
- **THEN** both use the same font files

#### Scenario: A missing letter

- **WHEN** the brand's font has no Japanese letters and a caption is in Japanese
- **THEN** the caption uses the next font in the fallback list that has them

### Requirement: Text SHALL use a layout from a fixed list

Every caption style, slide and cover SHALL name a layout from the shipped list or from the data folder's `layouts/`. Each layout SHALL declare its text boxes. Commands SHALL refuse a layout name that isn't known.

#### Scenario: An unknown layout

- **WHEN** a slide names the layout `photo-left`, which doesn't exist
- **THEN** `carousel set` exits 2
- **AND** the error lists the layouts there are
