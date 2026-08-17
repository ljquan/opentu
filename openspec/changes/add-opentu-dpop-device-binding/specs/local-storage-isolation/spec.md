## ADDED Requirements

### Requirement: Store Session Secrets Only In The Credential Vault

OpenTu SHALL store the device private key and refresh token only in a dedicated credential vault and SHALL keep the access token in page memory.

#### Scenario: Application persists user content

- **WHEN** OpenTu writes settings, tasks, canvases, workspace state, logs, analytics, or Service Worker messages
- **THEN** it SHALL NOT include the private key, refresh token, access token, DPoP proof, nonce, or authorization header

#### Scenario: User creates a normal backup

- **WHEN** OpenTu exports or restores a normal environment backup
- **THEN** the credential vault and all DPoP session material SHALL be excluded
- **AND** restoring content SHALL NOT create an authenticated Tuzi session

### Requirement: Scope Durable Content By Credential Identity

OpenTu SHALL isolate durable user content by stable `credential_id`, with an explicit separate namespace for anonymous use.

#### Scenario: User switches credentials

- **GIVEN** pending saves or open database handles exist for the current credential
- **WHEN** the active credential changes
- **THEN** OpenTu SHALL flush or cancel pending writes and close current handles before activating the target namespace
- **AND** SHALL restore only the target credential's canvas and task state

#### Scenario: Embedded session selects an existing credential

- **GIVEN** a stored credential has been verified for the current Tuzi host user
- **WHEN** OpenTu activates that credential during startup
- **THEN** it SHALL select the matching `credential_id` namespace before opening application content databases
- **AND** SHALL NOT select a namespace from an unverified host identity hint

#### Scenario: Embedded identity verification fails

- **GIVEN** OpenTu starts in the Tuzi binding iframe mode
- **WHEN** the host handshake, protected account verification, or verified namespace selection fails
- **THEN** OpenTu SHALL stop before opening any content namespace
- **AND** SHALL NOT mount the content application using an old active or anonymous namespace

#### Scenario: Legacy unscoped data is migrated

- **WHEN** OpenTu first opens legacy unscoped durable data after this change
- **THEN** it SHALL copy and verify that data into an explicit namespace using resumable idempotent migration markers
- **AND** SHALL preserve the legacy source until verification succeeds

### Requirement: Keep Credential Material Out Of Service Workers

OpenTu SHALL execute DPoP signing and token refresh only in the authenticated page context.

#### Scenario: Background task is queued

- **WHEN** OpenTu sends a generation task or provider configuration to a Service Worker
- **THEN** it SHALL NOT send a Tuzi token, private key, refresh token, DPoP proof, or reusable provider credential
