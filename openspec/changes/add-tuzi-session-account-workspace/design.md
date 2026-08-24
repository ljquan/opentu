## Context

Tuzi API already owns users, model permissions, usage logs, and browser Sessions. OpenTu already owns its standalone provider settings. The integration should compose these systems without copying identity or usage data into OpenTu storage.

## Goals / Non-Goals

- Goals: authenticate with the existing Tuzi Session; display current account, groups, models, prices and usage logs; automatically synchronize one Token-backed Provider per authorized group; preserve account isolation; keep standalone mode unchanged.
- Non-Goals: cloud canvas persistence, payment, new database tables, or replacing the existing Relay/Provider protocol implementations.

## Decisions

### Explicit embedded runtime configuration

Embedded mode and the Tuzi API base URL are supplied by trusted Vite build configuration. URL query parameters cannot enable Session mode or replace the API origin.

### One read-only Session client

OpenTu uses a small client with `credentials: 'include'` for the approved account, model, and log endpoints. It does not inspect cookies or persist Tuzi identity credentials.

### Session identity is authoritative

Tuzi API reads the user ID from the server Session and refreshes account status from the existing user cache. Legacy access-token requests continue to require their user ID consistency header.

### Explicit credentialed CORS

Tuzi API reads an explicit Origin allowlist from environment configuration. Credentialed responses never use `Access-Control-Allow-Origin: *`. Local development origins are configured explicitly.

### Existing settings surface

The account workspace is a view in the existing settings dialog. It is shown only in Tuzi embedded mode and does not create a separate landing page.

### Managed group Providers

Tuzi API exposes a thin Session-authenticated `/api/opentu/providers` orchestration endpoint. It derives the current user's assignable groups, reuses the existing Token creation and lookup rules, and returns Provider metadata plus the plaintext key needed to synchronize the existing OpenTu `providerProfilesSettings`. The endpoint never writes keys to logs and never exposes arbitrary Token management operations.

Managed Tokens use a stable `OpenTu Managed / <group>` name prefix and are idempotently reused per user and group. Rotation creates and validates the replacement before deleting the previous managed Token; the old Token must not remain as a disabled database record after a successful key change. The first implementation keeps the key in the existing OpenTu Provider credential storage for compatibility with the current browser Provider Transport; this is explicitly a browser-visible credential trade-off and is not presented as server-only secret storage.

The Provider base URL is derived from trusted build configuration and normalized to the fixed Tuzi `/v1` endpoint. Group/model/price metadata remains sourced from Tuzi's existing user-group, user-model and pricing endpoints; OpenTu does not calculate billing from a simplified group multiplier.

## Risks / Trade-offs

- Cross-site iframe cookies may be blocked. Prefer same-site deployment; local testing uses explicit HTTP development configuration.
- Browser-stored managed Tokens remain extractable through browser runtime, network tools or exported settings; a later server-side Session Provider is required for a stronger leak boundary.
- Concurrent first loads can race Token creation; the backend must serialize or transactionally re-check the managed name/group before inserting.
- Authentication middleware is shared with the existing Tuzi web client. Session and access-token paths require separate regression tests.
- Log response fields vary by deployment history. The client normalizes only the fields required by the view and preserves tolerant parsing.

## Rollback

Disable the OpenTu embedded-mode build flag and remove the OpenTu Origin from the Tuzi API allowlist. Standalone Provider/API Key behavior remains available.
