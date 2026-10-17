## Context

The repository is a Vite static frontend with Vercel rewrites. It has no
database or API server of its own, while B requires durable server-side secret
storage and server-side provider calls.

## Goals / Non-Goals

- Goals: secure provider storage, administrator-only mutations, model health
  verification, curated publication, and a stable public catalog boundary.
- Non-goals: replace Tuzi account billing, redesign the existing creative
  editor, or expose provider credentials to the browser.

## Decisions

- Decision: use Vercel Functions under `api/` so the existing Vercel deployment
  can serve API and static assets from one origin.
- Decision: use Neon Postgres for durable relational storage. Provider and
  model records need transactions, unique constraints, and queryable status;
  filesystem or in-memory storage is not durable on serverless deployments.
- Decision: encrypt API keys with AES-256-GCM using a deployment secret. The
  encryption key is never sent to the client and plaintext secrets are only
  held for the duration of an outbound provider request.
- Decision: authorize administrators by forwarding the incoming session cookie
  to Tuzi `/api/user/self` and requiring role >= 5, matching the existing app.
- Decision: publish a model only when its provider is enabled, its most recent
  health state is healthy, and the administrator has explicitly set `published`.
- Decision: retain a local fallback only when the server catalog is not
  configured. Production embedded deployments must use the server catalog.

## Alternatives considered

| Option | Implementation complexity | Runtime performance | Extensibility | Maintenance | Pitfalls |
| --- | --- | --- | --- | --- | --- |
| Browser localStorage | Low | Fast locally | Poor, per-device only | Low initially, high operationally | Exposes keys and cannot enforce publication |
| Separate Node service + database | High | Good with a long-lived process | Highest | Requires another deployable service | More hosting, auth, and release coordination |
| Vercel Functions + Postgres | Medium | Good for admin/catalog traffic | Good | Fits current deployment | Requires database and encryption env vars |

The selected option is Vercel Functions + Postgres because it satisfies B
without creating a second application deployment.

## Risks / Trade-offs

- Missing production environment variables make the API unavailable rather
  than silently falling back to unsafe browser storage.
- Serverless cold starts add latency to the first administrator request;
  catalog reads remain small and cacheable.
- Provider responses can be inconsistent; synchronization validates a bounded
  standard `/v1/models` response and records a readable failure state.

## Migration Plan

1. Create the database schema with the supplied migration endpoint/script.
2. Set `POSTGRES_URL` and `OPENTU_PROVIDER_ENCRYPTION_KEY` in Vercel.
3. Add providers through the administrator API, test them, sync models, and
   publish selected models.
4. Switch the marketplace to the public server catalog in embedded mode.
5. Remove browser provider editing after all production deployments use the
   server catalog.

## Open Questions

- The final generation proxy for every image, video, audio, and text protocol
  remains a follow-up. This change establishes the secure catalog and provider
  boundary first; existing Tuzi-managed generation remains compatible.
