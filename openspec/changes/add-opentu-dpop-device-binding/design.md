## Context

OpenTu runs at its own browser origin and currently routes some Tuzi traffic through an OpenTu same-origin proxy. DPoP signs the externally visible HTTP URI, so a proof for the OpenTu proxy URI cannot also represent the Tuzi upstream URI. The browser additionally persists user content, provider settings, tasks, and Service Worker state in several independent databases.

Tuzi already has OAuth token-family storage and Redis primitives, but its access tokens are ordinary Bearer tokens. Refresh replay, concurrent refresh, response loss, and multi-node request replay require one atomic contract shared by every API node.

## Goals / Non-Goals

- Goals:
  - bind OpenTu sessions to a non-exportable P-256 private key
  - make access and refresh replay detectable across Tuzi nodes
  - provide deterministic concurrent-refresh and response-loss behavior
  - isolate durable user content by `credential_id` without copying secrets into content storage
  - keep all Tuzi calls behind one DPoP-aware request layer
- Non-Goals:
  - proving that a browser or operating system is uncompromised
  - synchronizing private keys between browsers or devices
  - changing Tuzi payment settlement, refund, webhook, or idempotency behavior in the first delivery
  - trusting arbitrary reverse-proxy forwarding headers
  - silently migrating credentials from URL parameters or normal backups
  - changing Mermaid rendering, toolbox iframe messaging, CSP, analytics, reverse-proxy, or trusted-proxy configuration

## Decisions

### Browser key and credential vault

- OpenTu generates an ECDSA P-256 key with `extractable: false` and stores the private `CryptoKey` in a dedicated `opentu-credential-v1` IndexedDB database.
- The public JWK is canonicalized using RFC 7638 and Tuzi stores its thumbprint (`jkt`).
- Refresh token, `credential_id`, device metadata, and public JWK live beside the key. Access tokens and server nonces live only in page memory.
- The Service Worker never receives the private key, refresh token, access token, authorization header, or DPoP proof.
- A failed CryptoKey round trip is an unsupported-browser outcome, not a reason to generate an extractable key. The user must rebind after storage loss.
- The vault may retain the non-secret Tuzi `user_id` last verified for each credential so an embedded session can find a reuse candidate. The candidate is never authoritative: OpenTu activates it and calls the protected account endpoint before reuse, requiring both returned `user_id` and `credential_id` to match.

### Embedded host identity reconciliation

- The Tuzi parent derives its current user only from the authenticated host Session and sends that positive integer as a versioned, channel-bound identity hint after an explicit iframe request.
- OpenTu validates parent origin, parent window, protocol version, and channel before reading the hint. It never accepts a user identity from query parameters or treats a parent message as backend authentication.
- A verified existing credential may be reused without creating a new device. A missing, revoked, corrupt, or mismatched credential is removed from active use and OpenTu performs a fresh grant.
- A fresh exchange is complete only after `/api/opentu/account` returns the hinted `user_id` and the newly issued `credential_id`; only then is the user mapping persisted and binding success reported to the parent.
- Binding mode fails closed before application bootstrap when the host handshake, credential verification, or verified namespace selection fails. It never falls back to an old active or anonymous content namespace; standalone startup keeps its existing vault/anonymous behavior.
- A host user change creates a new channel and iframe lifecycle so messages or state from the previous Session cannot complete the next binding.

### External request URI

- OpenTu uses an explicit configurable Tuzi public origin. Development may use `http://127.0.0.1:5173`; production uses the public HTTPS Tuzi origin.
- DPoP endpoints and relay calls go directly to that origin and do not use the legacy OpenTu same-origin proxy.
- Tuzi validates CORS for an explicit OpenTu origin allowlist. It does not enable wildcard credentials or reuse the global permissive CORS middleware for these routes.
- `htu` excludes query and fragment; lowercases scheme and host; removes a default port; uses `/` for an empty path; normalizes dot segments and percent-encoding per RFC 3986; and preserves the semantic difference between `/a` and `/a/`.
- Tuzi uses its own request URL unless the immediate peer is in a configured trusted-proxy CIDR. Only then may a configured forwarding-header contract supply the original scheme and authority. Untrusted forwarding headers are ignored.

### Proof, nonce, and replay contract

- Proofs use `typ=dpop+jwt`, `alg=ES256`, an embedded public JWK, `jti`, `iat`, `htm`, and `htu`. Protected resource proofs also contain `ath` for the presented token.
- Tuzi verifies signature, JWK thumbprint binding, method, normalized URI, token hash, time window, and a server-issued nonce when required.
- Each accepted proof reserves `(jkt, jti)` with Redis `SET NX EX`. Redis failure rejects the request; production never falls back to a process-local replay map.
- Nonces are short lived, bound to the device/key context, single purpose, and returned with `DPoP-Nonce` on a standards-compatible challenge. OpenTu retries at most once with that nonce.

### Token family, refresh, and response loss

- Device grant creates a stable `credential_id`, one device row, and one OAuth token family bound to the key thumbprint.
- Access tokens are short lived and identify the family, credential, user, and `jkt` binding.
- Refresh tokens are opaque, one-time values stored only as hashes. Refresh rotation runs in one database transaction and one per-family critical section.
- The first valid refresh consumes the current token and creates the next generation. A concurrent request with the already-consumed token returns the same encrypted/short-lived recovery result only when its proof and family match the winner; it does not create another generation.
- The recovery result expires quickly and is deleted after use or expiry. After that window, reuse of a consumed refresh token revokes the whole family.
- If the successful response is lost, the same device may repeat once within the recovery window and receive the already-created successor. It never receives a newly rotated successor for the same generation.
- Device revocation, account security events, confirmed refresh reuse, and explicit family revocation invalidate all access and refresh tokens in that family.

### Provider request and relay boundary

- The OpenTu provider transport owns authorization, proof generation, nonce retry, single-flight refresh, and one retry of the original request.
- Relay paths are an explicit allowlist under `/opentu/v1/*`; arbitrary path forwarding is forbidden.
- Relay strips client-supplied authorization, cookie, forwarding, host, and hop-by-hop headers before constructing upstream requests.
- Account reads and device management use the same request layer.

### Storage namespace and backup

- Durable content is keyed or database-namespaced by `credential_id`. Anonymous data has a separate explicit namespace.
- Account switching closes active handles, flushes or cancels pending writes, changes namespace, and only then restores the target canvas.
- Legacy unscoped data is migrated once into an explicit namespace with a marker and resumable steps.
- Normal backup and restore exclude `opentu-credential-v1`, access/refresh tokens, proofs, nonces, and private/public key material. A restored content backup does not create an authenticated session.

## Risks / Trade-offs

- Some Safari or Firefox versions may not persist a non-exportable `CryptoKey` across restart. Mitigation: perform a real IndexedDB round-trip capability check and require rebind rather than weakening extractability.
- Direct cross-origin Tuzi requests require precise CORS and deployment configuration. Mitigation: fail startup diagnostics with a clear origin mismatch and keep origin configuration environment-specific.
- Per-credential storage migration can be interrupted. Mitigation: idempotent markers, copy-then-verify, and no deletion of legacy data until verification succeeds.
- Redis availability becomes part of authentication availability. This is intentional: replay protection must fail closed.

## Migration Plan

1. Land protocol types, verifiers, vault primitives, and tests without enabling the new session by default.
2. Add Tuzi device grant, refresh, account, relay, and revocation endpoints behind configuration.
3. Add OpenTu binding UI and DPoP-aware provider transport behind a feature flag.
4. Migrate local content into `credential_id` namespaces while keeping session material out of Service Workers and normal backups.
5. Enable non-payment traffic for an internal cohort, then broaden after multi-node Redis and browser restart tests.
6. Consider payment authentication only in a separate rollout after existing payment regression tests pass unchanged.

Rollback disables new grants and routing while preserving device/family records for audit and revocation. It does not export private keys or convert DPoP tokens into Bearer tokens.

## Open Questions

- The production Tuzi public origin and exact OpenTu CORS allowlist must be supplied per deployment.
- Safari and Firefox support remains a runtime capability result, not a user-agent allowlist.
