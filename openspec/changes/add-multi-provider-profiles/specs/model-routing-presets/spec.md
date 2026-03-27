## ADDED Requirements

### Requirement: Manage Default Model Presets

The system SHALL allow users to define multiple default model presets for switching between default model combinations.

#### Scenario: Create a new default model preset

- **GIVEN** the user opens preset management
- **WHEN** the user creates a new preset
- **THEN** the preset SHALL be stored independently with its own default model configuration

#### Scenario: Switch the active preset

- **GIVEN** multiple presets exist
- **WHEN** the user selects a different preset as active
- **THEN** subsequent generation requests without an explicit model choice SHALL use the default model references from the newly active preset

### Requirement: Apply Default Models By Task Type

Each preset SHALL allow separate default model targets for text, image, and video operations.

#### Scenario: Use different provider-backed models for text and image generation

- **GIVEN** a preset assigns a text model from one provider and an image model from another
- **WHEN** the user sends a text request and then an image request without explicitly overriding the model
- **THEN** each request SHALL use the credentials of the provider that owns the selected default model for its own route type

#### Scenario: Prevent selecting unsupported routes

- **GIVEN** a provider profile does not support a required capability such as video generation
- **WHEN** the user edits a preset
- **THEN** models belonging to that provider SHALL not be offered as valid targets for that unsupported route

### Requirement: Implicitly Bind Providers Through Model Selection

Selecting a model for a preset or an explicit user action SHALL implicitly determine the provider route for that request.

#### Scenario: Selecting a preset model binds the provider automatically

- **GIVEN** the user is editing the image route of a preset
- **WHEN** the user selects a model that belongs to a specific provider profile
- **THEN** the preset SHALL store that model reference
- **AND** future image requests that rely on preset defaults SHALL resolve through the provider that owns the selected model

#### Scenario: Explicit user model choice overrides preset default

- **GIVEN** a preset already has a default model configured for a route type
- **WHEN** the user explicitly chooses another provider-backed model at invocation time
- **THEN** the current request SHALL use the provider that owns the explicitly selected model
- **AND** the preset default SHALL remain unchanged unless the user explicitly saves it back into the preset

#### Scenario: Explicit model choice does not require a separate provider route setting

- **GIVEN** the user has already selected a provider-backed model in the runtime UI
- **WHEN** the request is submitted
- **THEN** the system SHALL resolve the provider credentials from that selected model reference
- **AND** SHALL not require a separate provider route selection step

### Requirement: Keep Presets Valid When Models Change

The system SHALL protect active routing when selected models are removed or become unavailable.

#### Scenario: Fallback when a preset model is removed

- **GIVEN** a preset references a model that is later removed from its provider catalog
- **WHEN** the preset is loaded
- **THEN** the system SHALL mark that route as needing reassignment or apply a safe fallback model from the same profile

#### Scenario: Preserve preset routes for unaffected task types

- **GIVEN** only one route type in a preset becomes invalid
- **WHEN** the preset is loaded
- **THEN** the remaining valid route types SHALL stay unchanged
