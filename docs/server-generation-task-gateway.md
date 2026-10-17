# Server generation task gateway

## B1 scope

B1 adds a server-owned task contract for OpenAI-compatible text generation,
image generation, and GPT Image edits. Video, audio, large uploads, production
billing, and frontend executor migration remain disabled until B2/B3.

Endpoints:

- `POST /api/generation/tasks`
- `GET /api/generation/tasks/:id`
- `POST /api/generation/tasks/:id/cancel`
- `GET /api/admin/generation/tasks?limit=30`

All user endpoints require the existing Tuzi session cookie. Write requests
must be same-origin. Task responses never include provider URLs, credentials,
headers, raw request inputs, or raw upstream errors.

## Required environment

- `POSTGRES_URL` or `POSTGRES_URL_NON_POOLING`
- `OPENTU_PROVIDER_ENCRYPTION_KEY`: 32-byte base64 or 64-character hex
- `TUZI_SESSION_API_BASE_URL`: optional; defaults to the trusted Tuzi API
- `OPENTU_GENERATION_RATE_LIMIT_PER_MINUTE`: optional; defaults to 12

Before deploying the API, run `pnpm db:migrate` with an explicitly configured
database URL and a migration role. The command does not load `.env` files.
It adds tables and columns in one transaction, serializes concurrent migrations
with an advisory lock, and records version `20260905-generation-v1`.
Existing provider/model records are preserved. Back up and test the migration
against staging before production. Production requests only read the migration
marker and fail closed when it is missing; they never create or alter tables.
Use a separate runtime role with the required SELECT/INSERT/UPDATE/DELETE
permissions, including SELECT on `opentu_schema_migrations`, without DDL rights.
Local non-production environments retain automatic schema initialization.

## Model rollout

1. Open `/admin/providers` with an administrator account.
2. Test the provider and synchronize its model list.
3. Set the model's route priority. Lower numbers win when providers publish the
   same model ID.
4. Mark the model as published.
5. Set billing to `free` only for models the platform intentionally funds.
   Unconfigured and external models are unavailable during the first public
   launch, including for administrator canary requests.
6. Enable the task gateway for the model.

Only models that are available, published, gateway-enabled, backed by a healthy
enabled provider, and selected by route priority appear in the public catalog.

## Canary requests

The first public launch does not support canary access to unconfigured models.
The `X-OpenTu-Canary` header is retained only as a reserved protocol field and
cannot bypass billing or launch policy.

Every create call requires an `Idempotency-Key` between 16 and 128 safe ASCII
characters. Retrying the same normalized request returns the original task;
using the key for different input returns `IDEMPOTENCY_CONFLICT`.

## Production boundary

Do not mark paid models as `free` to simulate wallet deductions. The
`external` billing mode remains fail-closed until a documented reserve, settle,
and release adapter is implemented and tested. B1 therefore supports safe
administrator canaries and intentionally free models, not paid public traffic.

Reference media must wait for the B2 object-storage upload flow. The public task
service currently rejects nonempty references with `UPLOADS_NOT_MIGRATED`, even
though the low-level adapter can process bounded inline image data.

Task completion, attempt completion, and usage writes commit together. If the
provider succeeds but persistence fails, the task retains its lease. Reading an
expired submitting task marks it `UPSTREAM_OUTCOME_UNKNOWN`, with retry disabled.
This is a reconciliation state represented as a failure, not proof that the
provider did no work. An operator must check the provider before any resubmission.
Transport timeouts and connection errors also disable retry. This does not yet
provide a durable worker, automatic result recovery, or a billing reconciliation
service. A user can still create another task with a new idempotency key.

The repository's Docker image and Netlify output are static frontend artifacts.
They do not implement these API endpoints. Do not deploy either alone as the
public multiuser service; provision a supported API runtime and same-origin
routing first. Vercel + Neon is the current documented baseline, pending the
final production infrastructure selection.

SSH deployment scripts require a prepopulated `known_hosts` entry verified using
a trusted server fingerprint. Unknown or changed host keys now stop deployment.
Password authentication uses `SSHPASS` rather than a password in command-line
arguments. Key authentication and removal of sudo-password piping remain
recommended deployment work.

## Verification

Run:

```powershell
pnpm exec tsc -p api\tsconfig.json
pnpm exec vitest run --config api\vitest.config.ts
pnpm exec nx typecheck web
pnpm exec nx build web
git diff --check
```

Database and real-provider smoke tests require deployment credentials and
should use an administrator canary model. Never place a real provider key in a
test fixture, browser log, or task response.
