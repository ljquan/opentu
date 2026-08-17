## 1. Protocol And Foundations

- [x] 1.1 Add shared API schemas and error codes for device grant, DPoP challenge, token rotation, account, relay, and revocation
- [x] 1.2 Implement and unit-test RFC 7638 JWK thumbprints and RFC 3986 `htu` normalization in Tuzi
- [x] 1.3 Implement an injectable DPoP verifier with strict ES256/JWK/header/claim validation
- [x] 1.4 Implement Redis replay and nonce stores that fail closed in production

## 2. Tuzi Device And Token Family

- [x] 2.1 Add backward-compatible device, grant, family-binding, and refresh-recovery schema migrations
- [x] 2.2 Add device grant creation/approval/exchange endpoints with explicit OpenTu CORS
- [x] 2.3 Issue short-lived DPoP access tokens and opaque one-time refresh tokens
- [x] 2.4 Implement serialized atomic refresh rotation, response-loss recovery, and confirmed-reuse family revocation
- [x] 2.5 Add account read, device list, device revoke, and family revoke endpoints

## 3. OpenTu Credential Session

- [x] 3.1 Add `opentu-credential-v1` IndexedDB vault and non-exportable P-256 key round-trip probe
- [x] 3.2 Add JWK thumbprint, DPoP proof signer, in-memory access token, and nonce cache
- [x] 3.3 Add bind/rebind/unbind session flow without URL or settings credentials
- [x] 3.4 Add single-flight refresh, one nonce retry, and one post-refresh request retry
- [x] 3.5 Reconcile the authenticated iframe host user with a verified `/account` response before reusing or persisting a credential mapping

## 4. Account, Provider Routing, And Relay

- [x] 4.1 Route account reads and provider calls through the DPoP-aware unified request layer
- [x] 4.2 Add explicit allowlisted `/opentu/v1/*` relay handlers and header stripping
- [x] 4.3 Keep legacy provider configuration isolated behind a migration flag
- [x] 4.4 Keep payment routes unchanged and run the existing payment regression suite

## 5. Credential-Scoped Storage

- [x] 5.1 Namespace workspace, task queue, application data, and recovery state by `credential_id`
- [x] 5.2 Make account switching close/flush handles before restoring the target canvas
- [x] 5.3 Add resumable, idempotent migration for legacy unscoped data
- [x] 5.4 Exclude the credential vault and all session material from normal backup, restore, logs, settings, tasks, and Service Worker messages
- [x] 5.5 Select the verified credential namespace before opening content databases and cover host-account reuse and mismatch transitions

## 6. Verification And Rollout

- [ ] 6.1 Run Tuzi unit, migration, controller, OAuth, relay, and payment regression tests
- [ ] 6.2 Run Redis multi-node replay, concurrent refresh, lost response, recovery expiry, and family revocation integration tests
- [x] 6.3 Run OpenTu type checks and vault/signer/request/storage/component tests
- [ ] 6.4 Verify non-exportable key persistence across a real restart in supported Safari and Firefox versions
- [ ] 6.5 Verify local integration with Tuzi at `http://127.0.0.1:5173` and OpenTu at `http://127.0.0.1:7200`
- [x] 6.6 Review final diffs and decide whether existing QA/DOC files need updates

Verification status on 2026-08-17:

- 6.1 remains open because the targeted OpenTu/DPoP suites pass, but the combined Tuzi package run still has pre-existing payment/subscription and permission-test initialization failures.
- 6.2 remains open because no external multi-node Redis integration environment was exercised.
- 6.4 remains open pending real Safari and Firefox restart testing.
- 6.5 remains open because standalone and fail-closed startup were verified locally, but the current browser session was not logged in, so the complete authenticated iframe binding handshake was not exercised.
- No separate QA or DOC file was added; the proposal, design, delta specs, task record, and automated tests already cover this delivery without duplicating documentation.
