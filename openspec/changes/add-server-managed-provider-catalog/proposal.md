# Change: Add server-managed provider catalog

## Why

Provider API keys are currently configured in browser settings. That makes the
administrator's credentials part of every browser profile and prevents the
platform from offering a single trusted model catalog to ordinary users.

## What Changes

- Add a Vercel Functions API for administrator-managed provider profiles.
- Encrypt provider API keys at rest and never return them from browser-facing
  responses.
- Validate administrator access through the existing Tuzi Session account.
- Add provider health checks and `/v1/models` synchronization on the server.
- Publish only enabled, healthy, explicitly published models to the public
  model marketplace.
- Add a typed frontend client for the management and public catalog APIs.
- Keep the existing browser-only configuration as a local-development fallback
  until a server catalog is configured.

## Impact

- Affected specs: provider-management, model-marketplace
- Affected code: `api/`, `apps/web/src`, deployment configuration, package deps
- **BREAKING** for production provider administration: a durable Postgres
  connection and `OPENTU_PROVIDER_ENCRYPTION_KEY` are required.
- Security: provider secrets stay server-side; user-facing catalog responses
  contain only safe provider and model metadata.
