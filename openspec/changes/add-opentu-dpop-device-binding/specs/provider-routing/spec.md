## ADDED Requirements

### Requirement: Route Tuzi Session Traffic Through DPoP Transport

The system SHALL route authenticated Tuzi account, model, and relay requests through one DPoP-aware provider transport.

#### Scenario: Access token is valid

- **GIVEN** an active in-memory access token and bound private key
- **WHEN** OpenTu sends a protected Tuzi request
- **THEN** the transport SHALL create a request-specific DPoP proof and send the request directly to the configured Tuzi public origin
- **AND** SHALL NOT route the proof through the legacy OpenTu same-origin proxy

#### Scenario: Server requests a nonce

- **WHEN** Tuzi challenges a request with a `DPoP-Nonce`
- **THEN** the transport SHALL cache the nonce in memory and retry the request at most once with a new proof

#### Scenario: Access token expires

- **WHEN** Tuzi rejects a request because its access token expired
- **THEN** the transport SHALL join one in-flight refresh operation for the credential
- **AND** SHALL retry the original request at most once with the resulting access token

### Requirement: Restrict OpenTu Relay Paths And Headers

Tuzi SHALL expose only explicit allowlisted OpenTu relay operations and SHALL construct their upstream headers server-side.

#### Scenario: Client requests an unlisted relay path

- **WHEN** OpenTu requests a path that is not registered under the explicit `/opentu/v1/*` contract
- **THEN** Tuzi SHALL reject the request without forwarding it upstream

#### Scenario: Client supplies forwarding or authorization headers

- **WHEN** a relay request includes client-controlled authorization, cookie, host, forwarding, or hop-by-hop headers
- **THEN** Tuzi SHALL strip those values
- **AND** SHALL apply only the server-owned upstream identity and allowlisted request headers
