## ADDED Requirements
### Requirement: Nano Banana 2.1 Image Parameters
The system SHALL expose `gemini-nano-banana-2.1` as an independent image model with 1K/2K/4K resolution, 14 documented aspect ratios, automatic ratio selection, and minimal/medium/high Thinking with default medium.

#### Scenario: Select the new model
- **WHEN** the user selects Nano Banana 2.1
- **THEN** its compatible parameters SHALL include resolution and Thinking
- **AND** SHALL NOT offer unsupported 512px resolution
- **AND** the application's default model SHALL remain unchanged

### Requirement: Nano Banana 2.1 Reference Images And Outputs
The system SHALL accept at most 14 reference images, send them as Google image parts, and extract final fileData or inlineData images while excluding thought parts.

#### Scenario: Submit reference images
- **WHEN** a Nano Banana 2.1 task includes valid reference images
- **THEN** the generateContent request SHALL include those images and the chosen Thinking level

#### Scenario: Reject excess references
- **WHEN** a Nano Banana 2.1 task includes more than 14 reference images
- **THEN** the system SHALL reject it before sending a generation request

#### Scenario: Return final images
- **WHEN** the response includes thought parts followed by final image parts
- **THEN** only final image parts SHALL be returned as generated assets
