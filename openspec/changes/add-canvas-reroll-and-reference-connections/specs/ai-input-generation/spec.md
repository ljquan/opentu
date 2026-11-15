## ADDED Requirements

### Requirement: Reroll inputs are isolated from canvas selection
The system SHALL resolve reroll inputs from the source generation record and SHALL NOT add the selected result solely because it is the current bound target. Displayed references and submitted references SHALL describe the same ordered input set.

#### Scenario: Reroll a result made from three references
- **GIVEN** result D was generated from A, B and C
- **WHEN** the user invokes reroll on D
- **THEN** the request SHALL use A, B and C in their recorded order
- **AND** SHALL NOT add D from target binding or subsequent selection notifications

#### Scenario: Original generation had no reference images
- **WHEN** the user rerolls a text-only image generation
- **THEN** the request SHALL remain free of reference images despite the selected output

#### Scenario: Explicit editing of a generated image
- **WHEN** the user explicitly chooses to edit result D
- **THEN** D SHALL be eligible as an input according to the existing edit and mask behavior

### Requirement: Editable reroll references have durable removal semantics
The system SHALL allow removal of any input reference in the restored editable draft without deleting its canvas source. Canvas selection refresh SHALL NOT silently restore a removed reference.

#### Scenario: Remove an original reference before submission
- **GIVEN** an editable reroll draft contains A, B and C
- **WHEN** the user removes B and submits
- **THEN** the actual request SHALL use only A and C
- **AND** B SHALL remain on the canvas

### Requirement: Reroll action and restore action are distinct
The system SHALL distinguish submitting a reroll from restoring a draft for editing. A single-image reroll SHALL submit one new image with the original effective model, route and supported generation parameters, using random seed behavior. Restore-for-editing SHALL preserve the original count for user review and SHALL NOT submit a request by itself.

#### Scenario: Reroll a single result from a batch
- **WHEN** the user invokes reroll on one result of a multi-image batch
- **THEN** exactly one new image task SHALL be submitted
- **AND** the existing result SHALL remain

#### Scenario: Restore inputs before editing
- **WHEN** the user invokes restore-for-editing
- **THEN** the original count, references, model and supported parameters SHALL appear in an editable draft
- **AND** no generation request SHALL occur until the user submits

### Requirement: Generation records preserve recoverable input identity
The system SHALL associate new results with versioned lightweight generation records containing ordered stable media references and effective input parameters. It SHALL reuse existing media storage and SHALL NOT embed credentials or media binary payloads in canvas recipe metadata.

#### Scenario: Original task history was removed
- **GIVEN** a result has a retained generation record and its media is available
- **WHEN** the user restores its inputs after task-history cleanup
- **THEN** the inputs SHALL be recoverable from that record

#### Scenario: Historical inputs cannot be recovered
- **WHEN** a requested reroll has missing source media or insufficient generation metadata
- **THEN** the system SHALL report missing inputs and offer an editable recovery path
- **AND** SHALL NOT silently substitute the selected output or submit incomplete inputs
