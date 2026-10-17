## ADDED Requirements

### Requirement: Server-side provider secret management

The platform SHALL allow an administrator to create, update, enable, disable,
test, and delete named provider profiles through an authenticated server API.
Provider API keys MUST be encrypted at rest and MUST NOT be returned in API
responses.

#### Scenario: Create provider without exposing the key

- **WHEN** an administrator submits a provider name, base URL, auth method, and
  API key
- **THEN** the server stores the encrypted key and returns the provider's
  metadata with a masked key state only

#### Scenario: Non-administrator mutation is rejected

- **WHEN** a signed-in account with role below 5 sends a provider mutation
- **THEN** the server returns `403` and does not read or modify provider data

#### Scenario: Provider test failure is recorded safely

- **WHEN** a provider health check fails
- **THEN** the server records an unhealthy state and returns a sanitized error
  without including the API key or authorization header

### Requirement: Server-side model synchronization

The platform SHALL synchronize provider models through the server using the
stored secret and SHALL record each model's operation category, availability,
and publication state.

#### Scenario: Successful model synchronization

- **WHEN** an enabled provider returns a valid `/v1/models` response
- **THEN** the server upserts the discovered models and marks the sync healthy

#### Scenario: Invalid provider response

- **WHEN** a provider returns an invalid or oversized model response
- **THEN** the server rejects the sync, preserves the previous catalog, and
  records a sanitized error
