## ADDED Requirements

### Requirement: Synchronize Managed Group Profiles Into Existing Provider Settings

Embedded OpenTu SHALL synchronize Tuzi-managed group keys into stable managed `providerProfiles` entries and SHALL invoke Tuzi providers through the existing direct provider request path.

#### Scenario: Managed groups synchronize

- **WHEN** Tuzi returns a managed key for a usable group
- **THEN** OpenTu SHALL upsert only the matching stable managed provider profile
- **AND** SHALL preserve unrelated manual profiles, catalogs, presets, and provider settings
- **AND** SHALL persist the managed profile in the existing config store under the verified credential namespace

#### Scenario: A managed group key rotates

- **WHEN** Tuzi returns a replacement key for one group
- **THEN** OpenTu SHALL replace only that group's managed profile key
- **AND** subsequent requests for that profile SHALL use the existing URL, payload, authentication-header, and task behavior

#### Scenario: Standalone OpenTu starts

- **WHEN** OpenTu runs without a verified Tuzi embedded credential
- **THEN** it SHALL NOT request or create Tuzi-managed group keys
- **AND** SHALL preserve the existing manual API-key workflow

## MODIFIED Requirements

### Requirement: Route Tuzi Provider Traffic Through Managed Direct Transport

The system SHALL use DPoP for embedded account and managed-key control operations and SHALL use the selected managed group profile through the existing direct provider transport for model generation.

#### Scenario: Embedded model generation starts

- **GIVEN** a verified embedded credential and a synchronized managed group profile
- **WHEN** OpenTu submits an image, video, audio, or other supported provider request
- **THEN** it SHALL use the profile's existing provider URL, payload, retry, task, and result behavior
- **AND** SHALL apply the managed API key using the profile's existing authentication strategy
- **AND** SHALL NOT prefer the DPoP Relay for that provider request

#### Scenario: Account or managed-key request starts

- **WHEN** OpenTu reads account data, synchronizes groups, or rotates one managed key
- **THEN** it SHALL continue to use the DPoP-protected OpenTu account client
