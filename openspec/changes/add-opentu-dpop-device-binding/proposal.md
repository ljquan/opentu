# Change: Add OpenTu DPoP device-bound Tuzi sessions

## Why

OpenTu currently relies on long-lived provider credentials that can be copied through URLs, settings, tasks, Service Worker messages, or backups. Tuzi currently issues ordinary Bearer OAuth tokens, so possession of a copied token is sufficient to replay it from another device.

This change replaces that integration path with an explicit device grant and a DPoP-bound OAuth token family. It also separates credentials from user content without changing the application's existing rendering, toolbox, or production network-security configuration.

## What Changes

- Add a Tuzi device-grant flow that binds an OpenTu installation to a non-exportable P-256 browser key.
- Issue DPoP access and refresh tokens in one revocable token family, with atomic refresh rotation, nonce challenges, and Redis-backed replay protection.
- Add account, explicit `/opentu/v1/*` relay, device listing, and device revocation endpoints protected by the same proof contract.
- Add an OpenTu credential vault, in-memory access-token session, DPoP signer, automatic nonce retry, and serialized refresh recovery.
- Scope durable OpenTu content by stable `credential_id`, while keeping secrets out of content databases, Service Workers, logs, tasks, canvases, URL parameters, and normal backups.
- Keep the existing Tuzi payment implementation unchanged in the first delivery; payment can use the new session only after the non-payment authentication and revocation path passes the release gates.

## Impact

- Affected specs:
  - `opentu-device-auth` (new)
  - `local-storage-isolation` (new)
  - `provider-routing`
- Affected OpenTu code:
  - `packages/drawnix/src/services/provider-routing/*`
  - new credential vault and DPoP signing services
  - IndexedDB workspace/task/config storage boundaries
- Affected Tuzi code:
  - OAuth models and migrations
  - DPoP middleware, Redis replay store, nonce handling, device endpoints
  - explicit OpenTu relay and account routes
- Compatibility:
  - legacy URL-token configuration remains readable only for a controlled migration window and is never copied into the new credential vault automatically
  - existing Tuzi OAuth clients and payment routes remain behaviorally unchanged
  - Mermaid rendering, toolbox iframe messaging, CSP, analytics, reverse-proxy, and trusted-proxy behavior are outside this change
