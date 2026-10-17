## ADDED Requirements

### Requirement: Present Administrator-Published Models

The system SHALL present consumer model marketplace entries from the model IDs
available to the signed-in user through the Session-authenticated platform API.

#### Scenario: Published models are available
- **GIVEN** the administrator has enabled models for the user's group
- **WHEN** the user opens the model marketplace
- **THEN** the marketplace SHALL present those consumer-facing models
- **AND** SHALL NOT require or expose a provider API key

#### Scenario: Published model API is unavailable
- **GIVEN** the application is running standalone or the Session API is unavailable
- **WHEN** the user opens the model marketplace
- **THEN** the marketplace SHALL present a curated fallback catalog
- **AND** the rest of the home page SHALL remain usable

### Requirement: Classify Marketplace Models

The system SHALL classify marketplace entries into featured, image, video,
music, text, and research views.

#### Scenario: User selects a category
- **WHEN** the user selects a marketplace category
- **THEN** only models assigned to that category SHALL be presented
- **AND** the selected category SHALL expose its current model count

#### Scenario: Infrastructure endpoint is returned
- **GIVEN** the published model list contains embeddings, moderation,
  transcription, or provider operation actions
- **WHEN** the marketplace adapts the model list
- **THEN** those entries SHALL NOT be presented as consumer models

### Requirement: Search And Progressively Reveal Models

The system SHALL allow users to find models without rendering an unbounded
catalog at once.

#### Scenario: User searches the catalog
- **WHEN** the user searches by model name, provider, identifier, or capability
- **THEN** matching marketplace entries SHALL be shown across the active category

#### Scenario: Category contains many models
- **GIVEN** the active category contains more models than the initial display limit
- **WHEN** the user requests more models
- **THEN** the marketplace SHALL progressively reveal additional entries

### Requirement: Route Models To Appropriate Creation Surfaces

The system SHALL route marketplace actions to a creation surface appropriate
for the model category.

#### Scenario: User selects a music model
- **WHEN** the user starts creating with a music model
- **THEN** the application SHALL open the music station

#### Scenario: User selects another creative model
- **WHEN** the user starts creating with an image, video, text, or research model
- **THEN** the application SHALL open the creative center

