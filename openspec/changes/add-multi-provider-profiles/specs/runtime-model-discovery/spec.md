## MODIFIED Requirements

### Requirement: Discover Models From Base URL And API Key

The system SHALL allow users to fetch a provider's available model list using the currently entered Base URL and API key, and SHALL scope the result to the specific provider profile being managed.

#### Scenario: Normalize root base URL before discovery

- **GIVEN** the user enters a provider root URL such as `https://api.tu-zi.com`
- **WHEN** the system performs model discovery for that provider profile
- **THEN** the request SHALL be sent to the normalized models endpoint under `/v1/models`

#### Scenario: Keep discovery results isolated per profile

- **GIVEN** the user has multiple provider profiles
- **WHEN** the system performs model discovery for one profile
- **THEN** the fetched model list SHALL update only that profile's catalog
- **AND** SHALL not overwrite the discovered or selected models of other profiles

#### Scenario: Surface discovery failure without breaking other profiles

- **GIVEN** the current Base URL or API key cannot fetch a valid model list for one profile
- **WHEN** the discovery request fails, returns non-JSON, or returns an empty list
- **THEN** the user SHALL receive a visible failure message
- **AND** catalogs belonging to other profiles SHALL remain available

#### Scenario: Discover models from the provider management flow

- **GIVEN** the user is viewing a provider configuration
- **WHEN** the user triggers model management for that provider
- **THEN** the discovery request SHALL execute in the context of that provider
- **AND** the user SHALL be able to review and save selected models without navigating to a separate top-level model management section

### Requirement: Reuse Runtime Model Lists Across Selectors

All model selectors that currently depend on static model lists SHALL resolve models from provider-scoped catalogs while preserving provider provenance, with static models remaining available as system defaults.

#### Scenario: Selectors show enabled provider-backed models grouped by provider

- **GIVEN** one or more enabled provider profiles have selected models in their catalogs
- **WHEN** the user opens an image, video, or text model selector
- **THEN** the selector SHALL show the selected provider-backed models grouped by provider
- **AND** SHALL continue to expose system models as fallback options

#### Scenario: Preset switching updates default selection without hiding provider models

- **GIVEN** the user switches to another active preset
- **WHEN** the model selector is next resolved
- **THEN** the selector default value MAY change based on the newly active preset
- **AND** the available provider-scoped model list SHALL remain derived from enabled provider catalogs rather than only the active preset

#### Scenario: Selector keeps model ownership information

- **GIVEN** a selector shows models from multiple provider catalogs
- **WHEN** the user chooses a model
- **THEN** the selection result SHALL preserve both `modelId` and owning `profileId`
- **AND** subsequent request routing SHALL be able to resolve credentials from that preserved model ownership
