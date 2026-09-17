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

### User-scoped generated-image previews

The recent-calls table derives preview URLs only from the sanitized `other` payload returned by the existing user-scoped Tuzi log endpoint. Canonical `generated_image_delivery.entries` marked as visible to the user take precedence; legacy `generated_image_url` and `generated_image_urls` remain compatibility fallbacks. The client accepts only credential-free HTTP(S) URLs or Tuzi API-relative paths, caps the number of extracted URLs, and never interprets request/reference image fields as generated results.

The preview column lazily loads the first generated image and shows a count when one request produced multiple images. Remote preview requests omit the page Referer, and a failed candidate advances to the next validated URL so a stale upstream address does not hide an available Tuzi-hosted copy. Missing or non-image results use a stable empty state; records whose validated result URLs are exhausted show an image-expired state instead of rendering an untrusted URL. The table never decodes every result from a multi-image request at once.

Dragging a preview publishes only standard browser drag payloads (`text/uri-list`, `text/plain`, and safe image HTML) containing the validated result URL. The existing canvas drop plugin remains responsible for converting the screen drop point to a canvas point, loading the image, and inserting it. No API key, system token, user ID, raw log payload, Base64 body, or signed request headers are placed in drag data.

Reloading the account logs after local data has been cleared can rediscover previews because the source records belong to Tuzi API rather than IndexedDB. This is recovery of server-retained result references, not a new durability guarantee: a result cannot be recovered when Tuzi API did not retain a user-visible URL or when the retained upstream URL has expired and no durable Tuzi-hosted copy exists.

### Managed group Providers

Tuzi API exposes a thin Session-authenticated `/api/opentu/providers` orchestration endpoint. It derives the current user's assignable groups, reuses the existing Token creation and lookup rules, and returns Provider metadata plus the plaintext key needed to synchronize the existing OpenTu `providerProfilesSettings`. The endpoint never writes keys to logs and never exposes arbitrary Token management operations.

Managed Tokens use a stable `OpenTu Managed / <group>` name prefix and are idempotently reused per user and group. Rotation creates and validates the replacement before deleting the previous managed Token; the old Token must not remain as a disabled database record after a successful key change. The first implementation keeps the key in the existing OpenTu Provider credential storage for compatibility with the current browser Provider Transport; this is explicitly a browser-visible credential trade-off and is not presented as server-only secret storage.

Connected users can reopen the same authorized-group selector from the Provider list. The selector preselects the persisted groups, so adding another group submits the union of the existing and newly selected groups instead of accidentally removing an existing Provider.

When the Tuzi parent site already owns the token-creation guidance and group selector, it hands the numeric user ID, system token, and selected group to embedded OpenTu in a namespaced URL fragment. Fragments are not sent in HTTP requests and therefore do not enter ordinary reverse-proxy access logs. OpenTu validates and stores the values during startup, removes the fragment immediately, keeps legacy query parsing during migration, synchronizes the selected managed Provider, and selects its first discovered image model so the prompt workflow is ready without a second configuration step.

The Provider base URL is derived from trusted build configuration and normalized to the fixed Tuzi `/v1` endpoint. Group/model/price metadata remains sourced from Tuzi's existing user-group, user-model and pricing endpoints; OpenTu does not calculate billing from a simplified group multiplier.

## Risks / Trade-offs

- Cross-site iframe cookies may be blocked. Prefer same-site deployment; local testing uses explicit HTTP development configuration.
- Browser-stored managed Tokens remain extractable through browser runtime, network tools or exported settings; a later server-side Session Provider is required for a stronger leak boundary.
- Fragment handoff avoids server access-log exposure but remains visible to same-page browser code and history until OpenTu removes it during startup; strict trusted-origin validation and immediate cleanup limit that exposure.
- Cross-origin image hosts may block preview loading or canvas import even when the URL is present; the UI must keep the log usable and report the failed insert without retrying a paid generation request.
- Concurrent first loads can race Token creation; the backend must serialize or transactionally re-check the managed name/group before inserting.
- Authentication middleware is shared with the existing Tuzi web client. Session and access-token paths require separate regression tests.
- Log response fields vary by deployment history. The client normalizes only the fields required by the view and preserves tolerant parsing.

## Rollback

Disable the OpenTu embedded-mode build flag and remove the OpenTu Origin from the Tuzi API allowlist. Standalone Provider/API Key behavior remains available.
