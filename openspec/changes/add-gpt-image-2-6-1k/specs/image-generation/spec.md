## ADDED Requirements

### Requirement: Isolate GPT Image 2.6 1K Request Capabilities
The system SHALL recognize `gpt-image-2.6-1k` independently from GPT Image 2, GPT Image 2.5, and Gemini parameter families, preserve the exact requested model ID, and send only parameters verified for the selected provider's contract.

#### Scenario: Switching from a high-resolution model
- **GIVEN** a user previously selected a model with 4K resolution and advanced quality parameters
- **WHEN** the user switches to `gpt-image-2.6-1k`
- **THEN** unsupported inherited parameters SHALL NOT be sent
- **AND** the UI SHALL NOT promise fixed output pixels or expose unverified resolution tiers

#### Scenario: Preserve the selected provider and model
- **WHEN** the user submits a `gpt-image-2.6-1k` image request
- **THEN** the request SHALL use the selected provider's existing compatible adapter
- **AND** the model ID SHALL remain `gpt-image-2.6-1k` without an implicit 2.5 alias substitution

#### Scenario: Preserve a verified explicit image size
- **WHEN** the user selects automatic sizing, 1:1, 2:3, 3:2, 16:9, or 9:16 for `gpt-image-2.6-1k`
- **THEN** generation and editing adapters SHALL preserve the corresponding verified request value (`auto`, `1024x1024`, `1024x1536`, `1536x1024`, `16x9`, or `9x16`)
- **AND** explicit supported sizes SHALL NOT be overwritten with `auto`
- **AND** unsupported inherited dimensions SHALL fall back to `auto` without forwarding unverified resolution or quality tiers
- **AND** the UI SHALL describe these choices as requested ratios while preserving actual returned pixels and GIF media

### Requirement: Preserve Returned Image Media
The system SHALL preserve actual returned dimensions and verified PNG/JPEG/WebP, GIF, and SVG media formats through image-result handling, original-media caching, image preview, and original-file download.

#### Scenario: Prompt requests an animated GIF
- **GIVEN** a prompt requests a GIF and the provider returns a valid animated GIF
- **WHEN** the result is inserted, cached, previewed, restored, or downloaded
- **THEN** the original media SHALL retain its GIF MIME type and animation frames
- **AND** an original-file download SHALL use the GIF extension
- **AND** thumbnail generation SHALL NOT replace the original asset

#### Scenario: Provider returns SVG media
- **GIVEN** the provider returns valid SVG media in a verified response form
- **WHEN** the result is displayed or downloaded
- **THEN** the system SHALL preserve the SVG format and use the `image/svg+xml` MIME type
- **AND** the preview SHALL treat SVG as an image resource rather than injecting it into application DOM

#### Scenario: Actual dimensions differ from request
- **GIVEN** the generated image has different dimensions from the requested size
- **WHEN** the result is placed on the canvas
- **THEN** the system SHALL use the actual media dimensions
- **AND** SHALL NOT resize the original merely to match the model's `1k` suffix

#### Scenario: Unexpected or invalid media response
- **WHEN** the provider returns an unsupported or invalid media payload
- **THEN** the system SHALL report an actionable failure rather than mark a broken image as successfully generated
