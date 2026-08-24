## ADDED Requirements

### Requirement: Trusted Tuzi embedded mode

The system SHALL enable Tuzi embedded mode only from trusted build configuration and SHALL NOT allow URL query parameters to enable the mode or replace its API base URL.

#### Scenario: Untrusted URL configuration

- **WHEN** a standalone OpenTu URL contains Tuzi Session, settings, or API-key query parameters
- **THEN** the application SHALL remain in standalone mode and SHALL NOT use those values as Tuzi credentials or configuration

### Requirement: Session-backed account access

The system SHALL use the existing Tuzi browser Session to request the current account and available models without exposing or persisting a Tuzi system access token.

#### Scenario: Valid Session

- **WHEN** embedded OpenTu requests account data with a valid Session
- **THEN** Tuzi API SHALL derive identity from the Session and return only that user's account and model data without requiring a client user ID header

#### Scenario: Expired Session

- **WHEN** the Session is absent or invalid
- **THEN** Tuzi API SHALL return HTTP 401 with error code `SESSION_EXPIRED` and OpenTu SHALL stop protected requests and show a login-expired state

### Requirement: User-scoped usage logs

The system SHALL reuse existing Tuzi API log endpoints and SHALL scope every result to the authenticated Session user.

#### Scenario: Account isolation

- **WHEN** one user requests logs, summaries, or usage statistics
- **THEN** the response SHALL contain no records or aggregates belonging to another user

### Requirement: Credentialed Origin allowlist

Tuzi API SHALL allow credentialed cross-origin requests only from explicitly configured Origins and SHALL vary responses by Origin.

#### Scenario: Disallowed Origin

- **WHEN** a request carries an Origin that is not configured
- **THEN** Tuzi API SHALL NOT grant credentialed CORS access to the response

### Requirement: Standalone compatibility

The system SHALL preserve OpenTu standalone Provider/API Key behavior and Tuzi API legacy access-token authentication behavior.

#### Scenario: Legacy access-token request

- **WHEN** a client authenticates with an existing access token
- **THEN** Tuzi API SHALL continue to require and verify the compatible user ID header

### Requirement: Managed group Providers

The system SHALL derive OpenTu managed Providers from the authenticated user's authorized Tuzi groups and SHALL reuse the existing Token storage, group authorization, Relay, billing and log paths.

#### Scenario: First embedded load

- **WHEN** an authenticated embedded user loads OpenTu Provider settings
- **THEN** Tuzi API SHALL ensure at most one enabled managed Token for each authorized group and OpenTu SHALL synchronize the resulting Provider profile to the fixed Tuzi `/v1` URL

#### Scenario: Unauthorized group

- **WHEN** a requested group is not assignable to the Session user
- **THEN** the API SHALL reject the request without creating a Token or Provider

#### Scenario: Managed rotation

- **WHEN** the user requests a managed Provider rotation
- **THEN** the API SHALL create and validate the replacement before deleting the previous managed Token and SHALL not write plaintext keys to logs
- **AND** the previous managed Token SHALL NOT remain as a disabled Token record after a successful rotation

#### Scenario: Browser-visible credential

- **WHEN** OpenTu synchronizes a managed Provider in the first implementation
- **THEN** it SHALL store the generated Key in the existing local Provider credential storage and SHALL treat browser visibility as an accepted compatibility trade-off rather than a server-only secret guarantee

#### Scenario: Standalone Provider

- **WHEN** OpenTu runs without trusted Tuzi embedded configuration
- **THEN** existing user-managed Provider profiles and API-key execution SHALL remain unchanged
