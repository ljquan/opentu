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

- [x] 4.1 Add Session-authenticated provider catalog and selective ensure/rotate orchestration using existing Token storage.
- [ ] 4.2 Add idempotency, group authorization, rotation and no-secret-logging tests.
- [x] 4.3 Read authorized groups and pricing metadata and synchronize existing OpenTu Provider profiles and bindings.
- [x] 4.4 Add refresh/rotation controls without changing standalone Provider behavior.
- [x] 4.5 Let users choose authorized groups before first connection or system-token replacement, and create managed Tokens and Providers only for selected groups.
- [x] 4.6 Let connected users reopen the group selector and add another authorized group while preserving current selections.
- [x] 4.7 Add the validated parent/iframe postMessage bridge and 10-second standalone fallback.
- [x] 4.8 Move embedded system-token handoff to memory-only bridge credentials and remove URL handoff from the active path.
- [x] 4.9 Open the Tuzi account workflow only after a confirmed parent response, create a missing system token in place, and resume the pending message after Provider setup.

## 5. Verification

- [x] 5.1 Run focused Go tests and backend build checks.
- [x] 5.2 Run focused Vitest tests, type checks, and frontend build.
- [x] 5.3 Start both local services and verify managed Provider synchronization.
- [x] 5.4 Review final diffs and update QA/documentation status.
- [x] 5.5 Verify existing-token, missing-token creation, remembered-group and non-Tuzi fallback flows in a real browser.

## 6. Generated-image previews

- [x] 6.1 Add a bounded parser for user-visible generated-image URLs from sanitized Tuzi log metadata, including canonical-delivery precedence and legacy compatibility fields.
- [x] 6.2 Add a default preview column to recent calls with lazy loading, empty, failed-image, and multi-image states.
- [x] 6.3 Make valid preview images draggable through the existing canvas URL-drop contract without exposing credentials or raw log data.
- [x] 6.4 Add focused tests for URL validation, account-log response normalization, preview rendering, drag payloads, and records without recoverable images.
- [x] 6.5 Run focused Vitest tests, TypeScript checks, and production build; keep browser/page testing excluded unless separately requested.
