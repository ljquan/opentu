# Server integration status

## Verified

- API deployed at /srv/opentu/api.cjs, systemd service opentu-api, unprivileged opentu user, loopback port 3101.
- Real database readiness returns HTTP 200 using restricted application credentials.
- Anonymous session HTTP 401; generation catalog empty while the public generation switch is off.
- API regression suite and TypeScript checks pass, including HTTP parsing, unknown route, database readiness failure, session and forwarded-host origin bypass cases.
- Isolated integration-smoke.cjs ran on the server against actual PostgreSQL. Only identity was mocked, in a separate process with ephemeral loopback ports. Tested owner lookup, foreign-user lookup/cancellation denial, successful cancellation, session expiry, admin denial, idempotent reuse and conflicting payload rejection. Synthetic records removed in finally.
- Nginx port 80 forwards /api to Node. Unknown API paths return JSON 404 rather than index.html. Internal maintenance excluded from public routing.
- opentu-maintenance timer invokes the authenticated internal endpoint every five minutes using systemd-loaded credentials, without logging secrets.

## Blocking public launch

- External request to http://47.107.92.13.nip.io/api/health received HTTP 403 from Alibaba Cloud Beaver with Non-compliance ICP Filing. This is outside Nginx, not an application error. A temporary wildcard domain does not solve this deployment restriction.
- Tuzi login cannot transfer its domain cookies to nip.io. Independent PostgreSQL-backed accounts are now the selected authentication path.
- Real registration, login, logout, password change, session revocation/expiry, disabled-user rejection, CSRF, rate limiting and task isolation passed without calling a model provider.
- Browser smoke through the SSH tunnel passed registration, persisted session after refresh, password change, logout, new-password login and responsive desktop/mobile rendering. Temporary test data was removed afterward.
- The account-only frontend is published to SSH-only staging. The full workspace frontend, refresh recovery and local account storage isolation remain unfinished.
- Public generation remains false in the running service.

## SSH-only account staging

The independent account page is served by Nginx on `127.0.0.1:7310` and proxies same-origin `/api/*` to the API. It is intentionally not bound to a public interface. Use `ssh -N -L 7310:127.0.0.1:7310 aliyun-server` and open `http://localhost:7310/` to test registration and login. This is a staging tunnel, not a public launch URL.

Do not treat API health or mocked identity tests as full production acceptance.
