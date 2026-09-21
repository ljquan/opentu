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

### Requirement: User-visible generated-image previews

The system SHALL show generated-image previews for authenticated Tuzi usage-log records only when the user-scoped response contains a validated, user-visible generated-result URL.

#### Scenario: Generated image is available

- **GIVEN** a usage-log record contains one or more user-visible generated-image result URLs
- **WHEN** the recent-calls table renders the record
- **THEN** the preview column SHALL show the first generated image and indicate additional results
- **AND** a failed candidate SHALL advance to the next validated result URL without sending the page Referer
- **AND** the table SHALL NOT decode every result from a multi-image request at once

#### Scenario: Record has no recoverable image

- **GIVEN** a record is a failed request, a non-image request, contains only request/reference images, or has no valid user-visible result URL
- **WHEN** the recent-calls table renders the record
- **THEN** the preview column SHALL show a stable empty state, or an image-expired state when retained result URLs can no longer be loaded
- **AND** the client SHALL NOT infer a generated result from unrelated URLs

#### Scenario: Preview image is dragged to the canvas

- **GIVEN** a generated-image preview has a validated result URL and the current canvas is available
- **WHEN** the user drags the preview onto a canvas position
- **THEN** the system SHALL insert the image at that drop position through the existing canvas URL-drop path
- **AND** drag data SHALL contain no API key, access token, user identifier, raw log payload, or Base64 image body

#### Scenario: Local data was cleared

- **GIVEN** local task, asset, cache, and canvas data were cleared while Tuzi authentication was preserved
- **WHEN** the user reopens recent calls
- **THEN** the system SHALL reload previews from Tuzi's server-retained user-scoped log records
- **AND** results without a retained usable URL SHALL remain unavailable rather than being presented as recoverable

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

#### Scenario: Parent does not implement Tuzi handshake

- **WHEN** OpenTu sends a readiness message but receives no valid Tuzi context within 10 seconds
- **THEN** OpenTu SHALL open its original manual Provider/API-key workflow
- **AND** SHALL NOT show Tuzi token or group UI, call Tuzi operations, or write Tuzi integration state

### Requirement: Runtime Tuzi parent handshake

OpenTu SHALL enable the embedded Tuzi token workflow only after a response from the exact parent window and Origin with a matching protocol version, request ID and Tuzi environment marker.

#### Scenario: Existing system token

- **WHEN** the validated parent reports that the authenticated user already has a system token
- **THEN** it SHALL return the user ID, token and authorized groups
- **AND** OpenTu SHALL keep the system token in memory only and SHALL NOT show the token creation action

#### Scenario: Missing system token

- **WHEN** the validated parent explicitly reports that the authenticated user has no system token
- **THEN** OpenTu SHALL show a one-click token creation action inside the existing settings dialog
- **AND** SHALL request creation through the validated parent without navigating away

#### Scenario: Untrusted response

- **WHEN** a response has a mismatched Origin, source window, version, request ID or environment marker
- **THEN** OpenTu SHALL ignore it and SHALL NOT enable Tuzi mode or store its payload

### Requirement: Managed group Providers

The system SHALL derive OpenTu managed Providers from the authenticated user's authorized Tuzi groups and SHALL reuse the existing Token storage, group authorization, Relay, billing and log paths.

#### Scenario: First embedded load

- **WHEN** an authenticated embedded user loads OpenTu Provider settings
- **THEN** OpenTu SHALL first display the user's authorized groups without creating managed Tokens
- **AND** after the user confirms a selection, Tuzi API SHALL ensure at most one enabled managed Token for each selected authorized group and OpenTu SHALL synchronize only the resulting Provider profiles to the fixed Tuzi `/v1` URL

#### Scenario: Unselected authorized group

- **WHEN** an authenticated user does not select an otherwise authorized group during first connection or token replacement
- **THEN** Tuzi API SHALL NOT create a managed Token for that group
- **AND** OpenTu SHALL NOT create or display a managed Provider or replacement-Key control for that group

#### Scenario: Add another authorized group after connection

- **GIVEN** an authenticated user already has one or more connected managed group Providers
- **WHEN** the user reopens the authorized-group selector and selects another group
- **THEN** OpenTu SHALL preserve the existing group selections and ensure the newly selected managed Provider
- **AND** OpenTu SHALL synchronize the resulting Provider set and its available models

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
