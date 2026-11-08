## ADDED Requirements

### Requirement: Register the GPT Image 2.6 1K Channel Model
The system SHALL expose `gpt-image-2.6-1k` with complete model metadata and channel-specific capability wording through existing model discovery and selection flows, without changing the user's default model.

#### Scenario: Discover or select the new model
- **WHEN** the provider offers `gpt-image-2.6-1k`
- **THEN** model discovery and selectors SHALL resolve the exact model identity and compatible parameters
- **AND** SHALL NOT inherit Gemini parameters or register unavailable 2.6 suffix variants
- **AND** the description SHALL explain that `1k` does not guarantee 1024×1024 pixels

#### Scenario: Existing selections remain valid
- **GIVEN** saved settings reference an existing GPT Image 2 or 2.5 model
- **WHEN** the updated catalog is loaded
- **THEN** the saved model and provider selection SHALL remain valid
- **AND** their existing supported request behavior SHALL be preserved

### Requirement: Recognize the Exact GPT Image 2.6 Model
The system SHALL register `gpt-image-2.6` as an image model, preserve that exact ID and the selected provider, and resolve it through the existing GPT Image 2.6 parameter and request rules.

#### Scenario: Discover a model with generic text metadata
- **WHEN** the authenticated model list contains `gpt-image-2.6` with generic text metadata
- **THEN** automatic discovery SHALL use its registered image classification and image description
- **AND** SHALL NOT substitute a Flare, Sunburst, or 2.5 model ID

#### Scenario: Restore a previously misclassified catalog entry
- **GIVEN** an automatically discovered catalog saved `gpt-image-2.6` as a text model
- **WHEN** that catalog is restored
- **THEN** the model SHALL receive current registered image metadata without an additional network request
- **AND** the selected model ID and provider association SHALL be preserved
- **AND** explicit manual model configurations SHALL remain unchanged
