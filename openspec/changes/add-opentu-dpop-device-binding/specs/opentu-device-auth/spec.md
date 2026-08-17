## ADDED Requirements

### Requirement: Bind Each OpenTu Credential To A Device Key

The system SHALL bind every OpenTu-issued Tuzi credential to a non-exportable P-256 key and a stable `credential_id`.

#### Scenario: Device grant succeeds

- **GIVEN** OpenTu generated a non-exportable P-256 key and supplied its public JWK
- **WHEN** an authenticated Tuzi user approves and exchanges the device grant
- **THEN** Tuzi SHALL create a device and token family bound to the JWK thumbprint
- **AND** SHALL return an opaque refresh token and short-lived DPoP access token for the new `credential_id`

#### Scenario: Browser cannot persist the key

- **GIVEN** the browser cannot round-trip the non-exportable private `CryptoKey` through IndexedDB
- **WHEN** OpenTu evaluates device binding support
- **THEN** OpenTu SHALL report device binding as unsupported
- **AND** SHALL NOT retry with an exportable private key

#### Scenario: Embedded host session reuses a credential

- **GIVEN** the trusted Tuzi host reports its current authenticated user as a non-secret identity hint
- **AND** the credential vault contains a device previously verified for that user
- **WHEN** OpenTu starts in the host binding iframe
- **THEN** OpenTu SHALL activate the candidate credential and verify it through the protected account endpoint
- **AND** SHALL reuse it only when the returned user and `credential_id` both match

#### Scenario: Host and device identities do not match

- **GIVEN** the Tuzi host session user differs from the account returned for the active OpenTu credential
- **WHEN** OpenTu reconciles the embedded session
- **THEN** OpenTu SHALL reject that credential for the host session
- **AND** SHALL complete a fresh device grant bound by Tuzi to the current authenticated host user

### Requirement: Require Valid DPoP Proofs

Tuzi SHALL require a fresh, token-bound DPoP proof for every protected OpenTu endpoint.

#### Scenario: Valid protected request

- **GIVEN** an active DPoP access token bound to a key thumbprint
- **AND** a signed proof contains the request method, normalized public URI, token hash, valid time, unique proof ID, and required nonce
- **WHEN** Tuzi receives the request
- **THEN** Tuzi SHALL accept the proof only when all claims, signature, key binding, and replay reservation validate

#### Scenario: Redis replay protection is unavailable

- **WHEN** Tuzi cannot atomically reserve the proof ID in Redis
- **THEN** Tuzi SHALL reject the protected request
- **AND** SHALL NOT fall back to process-local replay state

### Requirement: Normalize The Public DPoP URI At A Trusted Boundary

Tuzi SHALL compare DPoP `htu` against a deterministic normalized public request URI and SHALL trust forwarding metadata only from configured proxy peers.

#### Scenario: Untrusted client sends forwarding headers

- **GIVEN** the immediate peer is not in a trusted-proxy CIDR
- **WHEN** the request includes forwarded scheme, host, or URI headers
- **THEN** Tuzi SHALL ignore those headers when computing the DPoP URI

#### Scenario: Query and fragment do not affect htu

- **WHEN** Tuzi normalizes an HTTP URI for DPoP comparison
- **THEN** it SHALL exclude query and fragment, normalize scheme/authority/path per RFC 3986, and preserve meaningful trailing slashes

### Requirement: Rotate Refresh Tokens Atomically

Tuzi SHALL rotate each refresh token once and SHALL provide deterministic recovery for a concurrent refresh or lost successful response.

#### Scenario: Concurrent refresh requests

- **GIVEN** two valid DPoP requests present the same current refresh token for one family
- **WHEN** they execute concurrently
- **THEN** exactly one request SHALL create the next refresh generation
- **AND** the matching loser MAY receive the same short-lived recovery result without creating another generation

#### Scenario: Consumed token reused after recovery expiry

- **GIVEN** a refresh token was consumed and its recovery result has expired
- **WHEN** the consumed token is presented again
- **THEN** Tuzi SHALL revoke the complete token family
- **AND** all family access and refresh tokens SHALL become invalid

### Requirement: Revoke Devices And Token Families

Tuzi SHALL allow an authenticated user to list and revoke OpenTu devices, and revocation SHALL invalidate the device token family.

#### Scenario: User revokes a device

- **WHEN** the user revokes an active OpenTu device
- **THEN** Tuzi SHALL mark its family revoked
- **AND** subsequent access and refresh attempts for that family SHALL fail

### Requirement: Keep Initial Payment Behavior Unchanged

The first DPoP delivery SHALL reuse existing payment services without changing settlement, webhook, refund, order idempotency, or authorization semantics.

#### Scenario: Non-payment rollout is enabled

- **WHEN** DPoP is enabled for OpenTu account and relay traffic
- **THEN** existing payment routes SHALL continue using their pre-change behavior
- **AND** DPoP payment authorization SHALL remain disabled until a separate rollout gate is approved
