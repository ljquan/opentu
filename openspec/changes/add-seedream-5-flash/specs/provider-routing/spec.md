## ADDED Requirements

### Requirement: Route Exact Seedream Flash Model To Tuzi V3

The system SHALL route the exact `doubao-seedream-5-0-flash-260915` model through a dedicated `tuzi.image.seedream-flash-json` binding and adapter using the selected provider's service host and existing authentication transport.

#### Scenario: Resolve a service root or v1 base URL

- **GIVEN** a selected provider configured with its service root or a trailing `/v1` base URL
- **WHEN** a Flash generation request is resolved
- **THEN** the resulting path SHALL be `/api/v3/images/generations`
- **AND** SHALL NOT contain an extra `/v1` prefix or declare a polling route
- **AND** the selected provider host and credentials SHALL be retained

#### Scenario: Correct a persisted legacy Flash binding

- **GIVEN** the exact Flash model has a persisted generic or legacy Seedream image binding
- **WHEN** an invocation is planned and its adapter is selected
- **THEN** the request SHALL resolve to the Flash contract
- **AND** SHALL NOT silently use the legacy Seedream route or a generic image adapter

#### Scenario: Preserve neighboring models

- **WHEN** the selected model is an existing Seedream model or an unknown similar model ID
- **THEN** the Flash-specific contract SHALL NOT be applied by a broad name or tag match
- **AND** existing supported Seedream models SHALL retain their current request contract
