## ADDED Requirements

### Requirement: Models SHALL be data, not code

Each provider SHALL ship the models it knows, each with its endpoint, what it's billed by, its price per unit and the date that price was checked. `config.json` SHALL be able to add a model or change a price under `models`. A model from a family its provider already handles SHALL need no code change.

#### Scenario: A new model in config.json

- **WHEN** `config.json` adds a FLUX model on FAL with its endpoint and price
- **THEN** `image generate --model` accepts it
- **AND** reserves its price

### Requirement: Old prices SHALL be flagged

`models list` SHALL show each job's models with their price and the date it was checked. `doctor` SHALL warn, without failing, when a model in use has a price checked more than 90 days ago.

#### Scenario: A stale price

- **WHEN** the image model in use had its price checked 120 days ago
- **THEN** `doctor` warns and says where to update the price
- **AND** still ends with `Ready.`
