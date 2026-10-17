# Change: Add server generation task gateway

## Why

Generation requests are currently executed through several browser-side
provider transports. This exposes provider protocol details and, in legacy
paths, provider credentials to the browser. It also makes retries, long-running
media jobs, billing, cancellation, and error handling inconsistent across
text, image, video, and audio creation.

The server-managed provider catalog establishes a trusted model boundary, but
published models cannot safely become a platform service until generation is
routed through a durable server-side task gateway.

## What Changes

- Add an authenticated generation task API:
  `POST /api/generation/tasks`, `GET /api/generation/tasks/:id`, and
  `POST /api/generation/tasks/:id/cancel`.
- Add durable generation task, attempt, upstream reference, usage, and billing
  reservation records in Postgres.
- Resolve each request from a published public model ID to its server-managed
  provider, protocol binding, and encrypted credential.
- Add bounded server-side adapters for synchronous text/image generation and
  asynchronous image/video/audio submission and polling.
- Add a same-origin upload boundary for reference files instead of sending
  large data URLs through serverless JSON request bodies.
- Normalize provider-specific results and errors into one client contract.
- Require idempotency keys and task leases to prevent duplicate submissions,
  duplicated media jobs, and duplicated charges.
- Add a billing reservation/settlement boundary. Chargeable tasks fail closed
  when no server-side billing adapter is configured; this change does not fake
  balance mutations in the browser.
- Migrate managed production generation flows and service-worker task recovery
  to the server task API while retaining an explicit local-development-only
  provider fallback.
- Remove ordinary-user API key dependencies and browser-side provider
  transports after the managed migration is verified.

## Impact

- Affected specs: generation-task-gateway, provider-routing,
  ai-input-generation
- Related change: `add-server-managed-provider-catalog`
- Affected code: `api/`, `packages/drawnix/src/services/`,
  `apps/web/src/sw/task-queue/`, generation UI error/recovery paths, deployment
  configuration, and tests
- **BREAKING** for managed production generation: browser-side API keys and
  arbitrary provider base URLs are no longer accepted by generation calls.
- **BREAKING** for chargeable production traffic: a supported server-side
  billing adapter must be configured before paid tasks can be submitted.
- Operational requirements: Postgres, provider encryption key, bounded
  serverless execution, and configured object storage for large references.

