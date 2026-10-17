## 1. Gateway foundation (B1)

- [x] 1.1 Add generation task, attempt, upstream reference, usage, billing
  event, and idempotency schema with indexes and retention fields
- [x] 1.2 Add authenticated user helpers, ownership checks, origin/CSRF checks,
  rate limits, request limits, and sanitized API errors
- [x] 1.3 Add typed operation schemas and reject client-provided provider URLs,
  paths, headers, and credentials
- [x] 1.4 Resolve only enabled, healthy, published server catalog models and
  decrypt provider credentials only inside outbound execution
- [x] 1.5 Implement create, read, cancel, idempotency, and task lease behavior

## 2. Initial synchronous adapters (B1)

- [x] 2.1 Add the server adapter registry and normalized result contract
- [x] 2.2 Add OpenAI-compatible text generation with usage normalization
- [x] 2.3 Add OpenAI-compatible image generation and GPT Image edit handling
- [x] 2.4 Add outbound SSRF protection, redirect denial, timeouts, content-type
  validation, and request/response size limits
- [x] 2.5 Add administrator-only canary controls and task diagnostics without
  exposing provider secrets

## 3. Async media and uploads (B2)

- [ ] 3.1 Add upload-init/finalize APIs and an object-storage adapter with
  ownership, type, size, and expiry validation
- [ ] 3.2 Add asynchronous image submit/poll adapters
- [ ] 3.3 Add video submit/poll adapters and preserve provider media metadata
- [ ] 3.4 Add audio/music submit/poll adapters, including continuation and
  infill identifiers
- [ ] 3.5 Add bounded stale-task refresh, execution leases, cron recovery,
  cancellation, timeout, and retry policy

## 4. Billing boundary

- [ ] 4.1 Add billing adapter types for reserve, settle, and release operations
- [ ] 4.2 Persist idempotent billing events and model pricing revisions per task
- [ ] 4.3 Fail chargeable task creation closed when billing is unavailable or
  the user has insufficient balance
- [ ] 4.4 Implement the separately approved production billing adapter and test
  success, failure, cancellation, retry, and partial-usage settlement

## 5. Frontend migration and cleanup (B3)

- [ ] 5.1 Add a typed task-gateway client and normalized client task models
- [ ] 5.2 Migrate direct text and image generation while preserving current
  canvas anchors, insertion, and recovery UX
- [ ] 5.3 Migrate video, audio, Agent, Skill, PPT, and batch workflow generation
- [ ] 5.4 Migrate service-worker task persistence to server task IDs and
  persisted status refresh
- [ ] 5.5 Remove ordinary-user API key prompts and managed-production access to
  credential-bearing invocation routes
- [ ] 5.6 Remove superseded browser transports only after protocol parity and
  rollback checks pass

## 6. Verification and operations

- [ ] 6.1 Add unit tests for lifecycle transitions, idempotency, leases, model
  publication checks, error redaction, and billing events
- [ ] 6.2 Add adapter contract tests with synchronous, asynchronous, malformed,
  oversized, timeout, redirect, and duplicate-submit fixtures
- [ ] 6.3 Add integration tests covering login expiry, insufficient balance,
  page reload recovery, cancellation, and cross-user task isolation
- [ ] 6.4 Run API/web typecheck, Vitest, build, Playwright generation flows, and
  secret scanning
- [ ] 6.5 Document schema migration, retention, cron, object storage, billing,
  environment variables, canary rollout, observability, and rollback
