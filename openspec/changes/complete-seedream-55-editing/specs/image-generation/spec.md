## ADDED Requirements

### Requirement: Continue Seedream 5.5 Editing From the Selected Result
The system SHALL provide an explicit continue-edit action that prioritizes the selected result as a reference, preserves the historical provider and applicable generation parameters, and does not submit a request until the user sends an instruction.

#### Scenario: Continue from one of multiple results
- **WHEN** the user selects a Seedream 5.5 result and continues editing
- **THEN** that exact selected image SHALL be the primary reference
- **AND** historical references SHALL be deduplicated without modifying the old task
- **AND** more than ten distinct references SHALL require visible user adjustment before submission
- **AND** generate-again SHALL retain its existing original-input behavior

#### Scenario: History is unavailable
- **WHEN** the selected result has no resolvable historical task
- **THEN** the application SHALL explain the missing history and SHALL NOT fabricate a model binding or submit generation

#### Scenario: Saved resolution tier uses lowercase K
- **WHEN** a Seedream 5.5 history record stores a supported resolution tier with lowercase k
- **THEN** restore, reroll and continue-edit SHALL retain the same tier using the selectable UI value
- **AND** the serialized image request SHALL preserve the original tier's pixel dimensions
