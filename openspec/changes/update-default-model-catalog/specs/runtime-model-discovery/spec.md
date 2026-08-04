## ADDED Requirements

### Requirement: Default Model Catalog Visibility

The system SHALL expose current model marketplace entries in the default selectable catalog while retaining hidden legacy model definitions for historical references and direct invocation compatibility.

#### Scenario: New marketplace models appear in the default catalog

- **GIVEN** a confirmed GPT-5.6, DeepSeek V4, or Seedance 2.0 model is available in the model marketplace
- **WHEN** the default model selector is resolved
- **THEN** the model SHALL be available to all users
- **AND** it SHALL use the shared model display ordering

#### Scenario: Legacy GPT models are hidden without deletion

- **GIVEN** a GPT-5.4-or-earlier model is retained for compatibility
- **WHEN** the default model selector is resolved
- **THEN** the legacy model SHALL not appear as a new selection
- **AND** a historical or pinned reference SHALL still resolve its model configuration

#### Scenario: Other provider catalogs remain independent

- **GIVEN** a user explicitly manages a non-default provider catalog
- **WHEN** selectable models are resolved for that provider
- **THEN** the default catalog hide list SHALL not delete or mutate that provider's stored model entries
