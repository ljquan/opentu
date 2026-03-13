## ADDED Requirements

### Requirement: Discover Models From Base URL And API Key

The system SHALL allow users to fetch a provider's available model list using the currently entered Base URL and API key.

#### Scenario: Normalize root base URL before discovery
- **GIVEN** the user enters a provider root URL such as `https://api.tu-zi.com`
- **WHEN** the system performs model discovery
- **THEN** the request SHALL be sent to the normalized models endpoint under `/v1/models`

#### Scenario: Normalize v1 base URL before discovery
- **GIVEN** the user enters a Base URL such as `https://api.tu-zi.com/v1`
- **WHEN** the system performs model discovery
- **THEN** the request SHALL be sent to the models endpoint under the same API namespace

#### Scenario: Surface discovery failure without breaking existing settings
- **GIVEN** the current Base URL or API key cannot fetch a valid model list
- **WHEN** the discovery request fails, returns non-JSON, or returns an empty list
- **THEN** the user SHALL receive a visible failure message
- **AND** the existing static model list fallback SHALL remain available

### Requirement: Adapt Remote Models To Runtime Model Config

Remote model list items SHALL be converted into the internal model configuration format used by model selectors.

#### Scenario: Reuse static metadata for known models
- **GIVEN** a discovered model ID matches an existing static model definition
- **WHEN** the runtime model config is built
- **THEN** the system SHALL reuse the known short code, tags, and default parameters when available

#### Scenario: Create safe defaults for unknown models
- **GIVEN** a discovered model ID does not match any static model definition
- **WHEN** the runtime model config is built
- **THEN** the system SHALL still expose that model as selectable
- **AND** assign safe fallback values for display label, short code, and description

### Requirement: Classify Discovered Models By Type

The system SHALL classify discovered models into image, video, or text groups for the corresponding selectors.

#### Scenario: Classify video models from endpoint hints
- **GIVEN** a discovered model exposes video-oriented endpoint types or video-specific model identifiers
- **WHEN** the runtime model config is built
- **THEN** the model SHALL appear in the video model selector

#### Scenario: Classify image models from endpoint hints
- **GIVEN** a discovered model exposes image-oriented endpoint types or image-specific model identifiers
- **WHEN** the runtime model config is built
- **THEN** the model SHALL appear in the image model selector

#### Scenario: Default non-image non-video models to text
- **GIVEN** a discovered model does not match image or video classification rules
- **WHEN** the runtime model config is built
- **THEN** the model SHALL appear in the text model selector

### Requirement: Group Discovered Models By Provider Vendor

The system SHALL present discovered models under provider vendor groupings compatible with the existing model dropdown vendor tabs.

#### Scenario: Use provider ownership as primary vendor hint
- **GIVEN** a discovered model includes a recognized `owned_by` value
- **WHEN** the runtime model config is built
- **THEN** the model SHALL be assigned to the mapped vendor group for dropdown display

#### Scenario: Fallback to model identifier for custom ownership
- **GIVEN** a discovered model uses a generic or custom `owned_by` value
- **WHEN** the runtime model config is built
- **THEN** the system SHALL infer the vendor from model identifier keywords when possible

### Requirement: Reuse Runtime Model Lists Across Selectors

All model selectors that currently depend on static model lists SHALL prefer the discovered runtime model lists when available.

#### Scenario: Settings dialog uses discovered lists
- **GIVEN** model discovery has completed successfully
- **WHEN** the user opens the settings dialog
- **THEN** the image, video, and text model selectors SHALL use the discovered runtime lists first

#### Scenario: Generation entry points use discovered lists
- **GIVEN** model discovery has completed successfully
- **WHEN** the user opens the AI input bar or generation dialogs
- **THEN** those selectors SHALL use the same discovered runtime lists
- **AND** continue to work with saved model IDs from settings
