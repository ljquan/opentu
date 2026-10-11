## ADDED Requirements

### Requirement: Preserve Baseline Image 2 Parameters

The system SHALL preserve the pre-change Image 2 parameter configuration and adapters after the user-requested rollback, without expanding advanced output controls to Image 2 models.

#### Scenario: Image 2 does not receive the new advanced controls

- **WHEN** the user selects `gpt-image-2` or `gpt-image-2-vip`
- **THEN** the ordinary parameter menu SHALL NOT show the advanced toggle added by this change
- **AND** pre-existing adapter and workflow behavior SHALL remain unchanged

#### Scenario: Image 2 background capability remains restricted

- **WHEN** the user configures `gpt-image-2` or its VIP variant
- **THEN** background options SHALL remain auto and opaque
- **AND** transparent background SHALL NOT become enabled by the advanced-output change

#### Scenario: Existing Image 2.5 behavior is preserved

- **WHEN** any of the five scoped Image 2.5 model IDs is selected
- **THEN** existing supported background and advanced output parameters SHALL remain functional
- **AND** transparent background with JPEG SHALL continue to be rejected

### Requirement: Preserve Baseline Watermark Behavior

The system SHALL withdraw the watermark additions from this change and preserve pre-existing watermark behavior.

#### Scenario: Cancelled watermark additions

- **WHEN** a scoped Seedream Lite, Seedance 2.0/Fast or MiniMax-H3 model is selected
- **THEN** this change SHALL NOT add a watermark control or request field
- **AND** existing Seedance 2.5 watermark behavior SHALL remain unchanged

### Requirement: Conditional Seedream Capability Verification

The system SHALL enable Seedream Lite prompt optimization, sequential generation, or layer decomposition only after a model-specific request and result contract is confirmed.

#### Scenario: Only Pro contract evidence exists

- **GIVEN** available evidence describes Seedream 5.0 Pro layer decomposition
- **WHEN** the selected model is the scoped Seedream 5.0 Lite model
- **THEN** the system SHALL NOT infer that Lite supports the capability

#### Scenario: Confirmed sequential generation produces several outputs

- **GIVEN** a confirmed Lite contract enables sequential generation
- **WHEN** the response contains several output URLs
- **THEN** all supported output URLs SHALL reach the existing multiple-result handling path
- **AND** sequence controls SHALL NOT implicitly multiply the ordinary batch task count
