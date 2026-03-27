## ADDED Requirements

### Requirement: Manage Multiple Provider Profiles

The system SHALL allow users to create and maintain multiple provider connection profiles at the same time.

#### Scenario: Add a new provider profile
- **GIVEN** the user opens provider configuration
- **WHEN** the user creates a new profile with a name, Base URL, and API key
- **THEN** the system SHALL save that profile independently from existing profiles

#### Scenario: Disable a provider profile without deleting it
- **GIVEN** an existing provider profile is configured
- **WHEN** the user disables that profile
- **THEN** the profile SHALL remain stored
- **AND** it SHALL not appear as an available routing target until re-enabled

### Requirement: Keep Model Catalogs Scoped To Profiles

Each provider profile SHALL own its own discovered and selected model catalog.

#### Scenario: Discover models for one profile without affecting another
- **GIVEN** the user has two provider profiles configured
- **WHEN** the user fetches models for one profile
- **THEN** the discovered models SHALL be stored only under that profile
- **AND** the other profile's discovered models SHALL remain unchanged

#### Scenario: Preserve selected models per profile
- **GIVEN** the user adds selected models under a specific provider profile
- **WHEN** the user switches to another profile
- **THEN** the selected model set from the first profile SHALL remain intact
- **AND** not be merged into the second profile automatically

### Requirement: Present Profile Summaries In Main Settings

The main settings surface SHALL summarize provider and model state without expanding full model lists inline.

#### Scenario: Show compact profile and model summary
- **GIVEN** the user has many added models under one or more profiles
- **WHEN** the user views the main settings surface
- **THEN** the system SHALL show compact counts and status summaries
- **AND** SHALL provide an entry into a provider-scoped model management flow instead of rendering the full list inline

### Requirement: Manage Models Within Provider Configuration

The system SHALL allow users to discover and select models from within the provider configuration flow, without requiring a separate top-level settings section for model management.

#### Scenario: Fetch and select models from a provider detail view
- **GIVEN** the user is editing a configured provider profile
- **WHEN** the user opens model management for that provider
- **THEN** the system SHALL fetch and present models in the context of that provider
- **AND** SHALL allow the user to save selected models back into that provider's catalog

### Requirement: Migrate Legacy Single-Provider Settings

The system SHALL migrate legacy single-provider settings into the new profile model without losing the user's existing configuration.

#### Scenario: Upgrade from legacy gemini settings
- **GIVEN** the user has an existing legacy `gemini` configuration but no multi-profile data
- **WHEN** the new settings system initializes
- **THEN** the system SHALL create a default provider profile from the legacy values
- **AND** preserve the existing default model selections through migration
