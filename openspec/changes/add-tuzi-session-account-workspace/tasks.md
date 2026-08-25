## 1. Proposal

- [x] 1.1 Review the approved implementation plan and both local repositories.
- [x] 1.2 Define scope, security boundaries, and non-goals.
- [ ] 1.3 Validate with OpenSpec CLI when the CLI is available.

## 2. Tuzi API

- [x] 2.1 Allow valid Session authentication without a client user ID header while preserving access-token consistency checks.
- [x] 2.2 Return stable Session-expired and account-disabled HTTP errors.
- [x] 2.3 Add explicit credentialed CORS allowlist configuration.
- [x] 2.4 Add focused authentication and CORS tests.

## 3. OpenTu

- [x] 3.1 Add trusted embedded runtime configuration.
- [x] 3.2 Add a typed Session API client for account, models, and logs.
- [x] 3.3 Add the Tuzi account and usage-log settings view with loading, empty, error, and expired-session states.
- [x] 3.4 Prevent URL settings/API-key injection in embedded mode.
- [x] 3.5 Add focused client and configuration tests.

## 4. Managed group Providers

- [x] 4.1 Add Session-authenticated provider catalog and ensure/rotate orchestration using existing Token storage.
- [ ] 4.2 Add idempotency, group authorization, rotation and no-secret-logging tests.
- [x] 4.3 Read authorized groups and pricing metadata and synchronize existing OpenTu Provider profiles and bindings.
- [x] 4.4 Add refresh/rotation controls without changing standalone Provider behavior.

## 5. Verification

- [x] 5.1 Run focused Go tests and backend build checks.
- [x] 5.2 Run focused Vitest tests, type checks, and frontend build.
- [ ] 5.3 Start both local services and verify managed Provider synchronization.
- [ ] 5.4 Review final diffs and update QA/documentation status.
