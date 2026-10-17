## ADDED Requirements

### Requirement: Managed production routing is server-owned

The system SHALL route managed production generation exclusively through the
server task gateway and SHALL NOT expose provider credentials or arbitrary
provider transport configuration to ordinary-user clients.

#### Scenario: Managed client resolves a selected model

- **GIVEN** the application runs in managed production mode
- **WHEN** a client selects a public catalog model for generation
- **THEN** the client SHALL retain only the public model ID, operation, and safe
  capability metadata
- **AND** the server SHALL resolve the credential-bearing provider route

#### Scenario: Gateway is unavailable

- **GIVEN** the application runs in managed production mode
- **WHEN** the server task gateway is unavailable
- **THEN** generation SHALL fail with a recoverable platform error
- **AND** SHALL NOT silently fall back to browser-stored provider credentials

#### Scenario: Explicit local development mode

- **GIVEN** an explicitly enabled local-development configuration
- **WHEN** no server catalog or task gateway is configured
- **THEN** existing local provider routing MAY remain available during migration
- **AND** SHALL be clearly excluded from managed production behavior

