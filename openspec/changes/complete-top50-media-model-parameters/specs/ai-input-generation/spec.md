## ADDED Requirements

### Requirement: Scoped Media Parameter Consumer Parity

The system SHALL carry each enabled parameter in this change through its applicable ordinary-canvas and native-workflow execution paths to a verified request consumer.

#### Scenario: Supported advanced field appears in native workflow

- **GIVEN** a parameter is enabled for a confirmed model and channel contract
- **WHEN** native workflow metadata is built
- **THEN** the parameter SHALL have a consumer entry and adapter allowlist coverage
- **AND** a user-selected value SHALL reach the final submit request

#### Scenario: Unsupported adapter field is selected

- **GIVEN** a field has no final consumer in the selected adapter or channel
- **WHEN** the user explicitly supplies that field
- **THEN** validation SHALL report the concrete limitation
- **AND** SHALL NOT silently discard the selected value and report full capability support

### Requirement: Model Scoped Parameter Persistence

The system SHALL preserve compatible user selections by provider and model identity without rewriting historical task records when new optional parameters are introduced.

#### Scenario: Switch between Image 2 and Image 2.5

- **GIVEN** Image 2.5 has a saved transparent background
- **WHEN** the user switches to Image 2 and later returns
- **THEN** unsupported transparent values SHALL NOT be sent to Image 2
- **AND** the compatible Image 2.5 selection SHALL remain recoverable

#### Scenario: Resume a task with optional values

- **WHEN** a task with explicit false or zero parameters is restored or retried
- **THEN** those values and its existing route snapshot SHALL be preserved
- **AND** unsupported fields SHALL be validated without deleting original stored data
