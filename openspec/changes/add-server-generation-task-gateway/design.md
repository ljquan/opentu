## Context

## Approved Launch Direction (2026-09-06)

The owner delegated selection to the implementation assistant after reviewing
the remediation options. The selected direction is A: Vercel Functions + Neon,
with managed object storage and durable media orchestration added in B2.
The first release charges no user wallet and accepts only explicitly free
text/image models. Provider costs remain the platform's responsibility.
Unconfigured administrator canaries and external billing are disabled for this
launch. This section supersedes the earlier B1 canary rollout below.

Task creation defaults disabled until OPENTU_PUBLIC_GENERATION_ENABLED=true.
Admission uses a short transaction-scoped global PostgreSQL advisory lock,
with global/provider/user concurrency and UTC daily task quotas. Expired work
is reconciled in bounded authenticated cron runs without automatic resubmission.
The initial defaults are 4/2/1 concurrent tasks and 100/10 daily tasks
(global/user). They are trial limits, not monetary spend guarantees.

Storage direction: a private S3-compatible bucket (R2 is recommended) with
short-lived signed operations. Orchestration direction: managed durable jobs
for provider submission/polling; do not hold a function open for long media.
Neither service is provisioned by changing repository configuration.

## Existing Context

The frontend currently has multiple execution paths for text, image, video,
audio, Agent workflows, and service-worker task recovery. Many paths resolve a
`baseUrl` and `apiKey` in the browser and call provider-specific adapters
directly. The completed server-managed catalog stores provider credentials and
publishes a safe model catalog, but generation still needs a server-owned
execution boundary.

The deployment target uses Vercel Functions and Neon Postgres. Serverless
functions cannot remain alive while a video or music provider polls for several
minutes. Large inline media payloads also exceed practical serverless request
limits.

The existing Tuzi session API exposes account balance and usage logs, but the
repository does not contain a documented server-side reserve, settle, or refund
contract. Billing must therefore be an explicit integration boundary instead
of an assumed balance mutation.

## Goals / Non-Goals

- Goals: hide provider credentials, enforce the published model catalog,
  provide one durable task contract, support synchronous and asynchronous
  providers, survive page reloads, prevent duplicate submission, sanitize
  errors, and establish correct billing boundaries.
- Goals: preserve current canvas insertion, progress feedback, batch workflow,
  and media metadata behavior while changing the transport underneath.
- Non-goals: implement a payment processor or recharge checkout, redesign the
  creative center, replace the administrator provider console, or support
  arbitrary client-selected upstream URLs and headers.
- Non-goals: migrate every legacy adapter in one release. Migration is phased
  by operation and protocol and must fail closed in managed production.

## Decisions

### Stable task protocol

The client submits a platform request rather than an upstream HTTP request:

```ts
type CreateGenerationTaskRequest = {
  modelId: string;
  operation: 'text' | 'image' | 'video' | 'audio';
  input: Record<string, unknown>;
  parameters?: Record<string, unknown>;
  references?: Array<{ uploadId: string; role: string }>;
  context?: { parentTaskId?: string; workflowId?: string };
};
```

The client cannot provide `baseUrl`, provider paths, authorization headers, API
keys, or arbitrary request headers. The server validates operation-specific
schemas and maps a published model to a provider binding.

### Durable lifecycle and leases

Tasks use a normalized lifecycle:

```text
queued -> submitting -> running -> succeeded
                           |          |
                           +-> failed +-> cancel_requested -> cancelled
```

Each task stores a user ID, public model ID, operation, sanitized input
metadata, result metadata, upstream task ID, retry counters, timestamps, and a
short execution lease. A compare-and-set lease prevents concurrent client
polls or cron runs from refreshing the same upstream task simultaneously.

Task creation requires an `Idempotency-Key` scoped to the authenticated user.
The same key and same request returns the original task. Reusing the key with a
different request is rejected.

### Serverless asynchronous execution

Synchronous providers may complete during `POST` within a strict timeout.
Asynchronous providers are submitted once, their upstream task ID is persisted,
and `POST` returns immediately. `GET` returns persisted state and may perform
one bounded upstream refresh when the task is stale and a lease is acquired.
An authenticated cron endpoint may refresh abandoned tasks in small batches.

The gateway never holds a Vercel Function open for a full video or music job.
Submit retries are allowed only when the adapter can prove idempotency or no
upstream task was created. Poll retries are safe and independently bounded.

### Adapter boundary

Adapters receive a trusted server-side invocation context containing the
decrypted provider credential, binding metadata, normalized request, timeout,
and response-size limits. They return either a completed normalized result or
an asynchronous upstream reference with polling metadata.

Initial adapters cover OpenAI-compatible text and image requests. Later batches
move the existing image variants, video providers, Suno-compatible audio, and
other asynchronous protocols behind the same interface. Existing protocol
translation tests are reused where practical.

### Upload and result storage

Large reference files use a same-origin upload-init endpoint and short-lived
signed upload targets backed by configured object storage. The task request
contains opaque upload IDs, not arbitrary URLs. The server verifies ownership,
content type, size, expiry, and malware/content-policy hooks before resolving an
upload for an adapter.

Small textual inputs remain JSON. Inline base64 media is rejected above a low,
documented limit. Provider output URLs are normalized and may be copied to
platform storage asynchronously; secret query parameters are never persisted in
logs or public task responses.

### Billing boundary

Chargeable tasks require a billing reservation before upstream submission. The
billing adapter receives the authenticated user, model pricing revision,
estimated units, and task ID. Successful tasks settle actual usage; failed or
cancelled tasks release the reservation unless the provider reports billable
usage. Every billing call is idempotent by task ID and operation.

The first implementation provides the billing interface, durable billing event
records, and fail-closed behavior. Production enablement requires one approved
adapter backed by either a documented Tuzi reserve/settle API or a separate
platform wallet ledger. Reading `/api/user/self` is not treated as permission to
modify that balance.

### Security boundary

- Only authenticated same-origin users can create, read, or cancel their tasks.
- Only enabled, healthy, published catalog models can be invoked.
- Provider origins and paths come only from administrator-controlled validated
  bindings. Redirects are disabled and private/link-local network destinations
  are rejected.
- Outbound requests have connect/total timeouts, body limits, response limits,
  content-type validation, and bounded polling frequency.
- Logs and client errors remove authorization data, cookies, provider keys,
  signed query strings, raw upstream payloads, and internal provider details.
- Write endpoints retain origin and CSRF checks. Rate limits apply per user,
  operation, and provider.

### Client migration

Managed production mode uses a typed task-gateway client. Existing UI code may
continue constructing operation-level inputs, but it no longer receives a
credential-bearing `ResolvedInvocationRoute`. The service worker stores the
server task ID and refreshes status rather than replaying provider requests.

Browser provider configuration and direct transports remain available only
behind an explicit local-development flag during migration. They are removed
from ordinary-user settings and production bundles after all supported
operations have migrated.

## Alternatives considered

| Option | Implementation complexity | Runtime performance | Extensibility | Maintenance | Pitfalls |
| --- | --- | --- | --- | --- | --- |
| Transparent HTTP proxy | Low to medium | Good | Medium | Medium | Client still knows provider protocols; high SSRF and request-forwarding risk |
| Unified task gateway | High | Controlled with durable polling | Highest | Medium after migration | Requires task schema, adapters, storage, leases, and billing integration |
| Partial synchronous proxy | Medium | Good for text/image | Low to medium | High | Permanent dual routing and user-key exposure for video/audio |

The selected option is the unified task gateway because it is the only option
that fully supports ordinary users without provider API keys and gives long
media tasks a recoverable lifecycle.

## Risks / Trade-offs

- Client-triggered refresh can delay completion visibility when no client is
  open. A small cron refresher handles abandoned tasks without a permanent
  worker.
- Object storage adds deployment configuration. Inline media remains bounded so
  a missing storage adapter fails clearly instead of exhausting function
  memory.
- Provider protocols are inconsistent. Adapter fixtures and normalized
  contracts limit provider-specific behavior to server modules.
- Billing integration is not currently documented. Paid traffic remains
  disabled until a real reserve/settle adapter is approved and tested.
- A phased migration temporarily carries two transports. Managed production
  selects one route deterministically; it never silently falls back to browser
  keys after a server failure.

## Migration Plan

1. B1: add schema, task API, auth/catalog validation, idempotency, leases,
   sanitized errors, and OpenAI-compatible text/image adapters.
2. Enable B1 for administrator test accounts and non-chargeable test models.
3. B2: add uploads, asynchronous image/video/audio adapters, bounded refresh,
   cancellation, timeout handling, and cron recovery.
4. Approve and configure a real billing adapter, then enable chargeable tasks.
5. B3: migrate frontend executors, service-worker recovery, Agent workflows,
   batch generation, and canvas result insertion to server task IDs.
6. Remove ordinary-user provider settings and production direct transports
   after parity tests pass for every published operation.
7. Roll back by disabling gateway publication per model; do not restore browser
   credentials in managed production.

## Open Questions

- Which production billing implementation will be approved: a documented Tuzi
  reserve/settle API or a separate platform wallet ledger?
- Which object-storage implementation will back signed uploads in the target
  deployment?
- Which published text and image models form the initial B1 canary set?
