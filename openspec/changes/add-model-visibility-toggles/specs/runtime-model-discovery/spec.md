## ADDED Requirements

### Requirement: Configurable Model Family Visibility

The system SHALL persist a model visibility policy and apply it consistently to front-end model selection lists without removing model definitions or changing request routing.

#### Scenario: Default hidden code list

- **GIVEN** a user has no saved model visibility settings
- **WHEN** the application loads the model catalog
- **THEN** the `happyhorse-1.0-*`, `gemini-omni-1.1-flash*`, `veo2`/`veo-2*`, and `veo3`/`veo-3*` families SHALL be hidden
- **AND** the existing `DEFAULT_HIDDEN_MODEL_IDS` list SHALL remain hidden

#### Scenario: Show the configured code list

- **GIVEN** a user turns off the “隐藏代码中指定的模型” switch
- **WHEN** any front-end model selector or model preset picker builds its options
- **THEN** every discovered or static model whose ID matches one configured family prefix or `DEFAULT_HIDDEN_MODEL_IDS` SHALL be eligible for display
- **AND** unrelated models SHALL remain available

#### Scenario: Preserve explicit model compatibility

- **GIVEN** an existing invocation preset or task explicitly references a model hidden by the policy
- **WHEN** the preset or task is loaded or routed
- **THEN** the reference SHALL remain valid and route using the existing model definition
- **AND** the hidden model SHALL not be added to unrelated new selector options

#### Scenario: Persist and restore the switch

- **WHEN** a user changes the visibility switch and saves settings
- **THEN** the choices SHALL be persisted through the existing settings store
- **AND** reopening the settings dialog or reloading the application SHALL restore the same choices
