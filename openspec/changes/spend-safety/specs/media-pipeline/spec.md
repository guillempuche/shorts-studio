## MODIFIED Requirements

### Requirement: Imported images SHALL be kept

When `image import` attaches an image to a beat, `image generate` SHALL keep that image, unless the beat is rerolled. `image import` SHALL refuse, with `conflict`, a beat whose paid request is saved but not fetched, and while `image generate` runs on the post. Its fix SHALL say how to fetch the paid image first, at no cost.

#### Scenario: Generating the other beats

- **WHEN** beat 0 has an imported image and images are generated
- **THEN** only the other beats are sent to the provider

#### Scenario: Importing over a saved request

- **WHEN** beat 1 has a saved request
- **AND** `image import --beat 1` runs
- **THEN** it fails with `conflict`
- **AND** beat 1's saved request is still there
- **AND** the fix names `image generate --post <slug> --beat 1`
