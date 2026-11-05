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
