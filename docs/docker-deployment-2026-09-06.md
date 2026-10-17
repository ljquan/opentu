# Docker deployment, 2026-09-06

The account staging frontend and API now run in Docker Compose on the server.
This is not acceptance of the full public application.

- For a fresh source build, run Compose from the checked-out repository's
  `docker/opentu` directory; its build context resolves two levels upward.
  The former `/srv/opentu/docker` staging layout required prebuilt files and
  is not compatible with this source-build Compose file.
- API: `opentu-api-docker`, loopback 3201, non-root, read-only filesystem,
  384 MB memory limit, dropped capabilities, health check and bounded logs.
- Web: `opentu-web-docker`, loopback 7320, non-root, read-only filesystem,
  128 MB memory limit, dropped capabilities, health check and bounded logs.
- Host Nginx forwards loopback 7310 to the Web container. The existing SSH
  tunnel provides `http://localhost:7310`. Public root remains staging-only.
- PostgreSQL remains on the host, loopback 5432. Its backups and permissions
  are unchanged. Host networking is intentional for loopback DB access;
  container networking does not provide network isolation in this deployment.
- Secrets are loaded from `/etc/opentu/runtime.env`, never built into images.
- Maintenance uses API port 3201. Legacy `opentu-api` systemd service is disabled.
- Official Docker Hub images were pulled through a temporary loopback SSH
  proxy. The Docker proxy override was removed after pulling.
- Browser registration, refresh persistence, password change, logout and
  new-password login passed against the container-backed account endpoint.
  Temporary browser accounts were deleted by the smoke script.

## Operations

Inspect without dumping environment secrets:
`cd /srv/opentu/source/docker/opentu && docker compose ps`

Rollback:
`sh /srv/opentu/source/docker/opentu/rollback.sh`

Rollback restores the original Nginx and maintenance files, starts the old
systemd API and stops the containers. Database changes are not rolled back.

## Remaining launch gates

Formal domain, ICP requirements and HTTPS remain unresolved. Email verification
and password recovery are not configured. Workspace account isolation and the
full frontend gateway migration remain incomplete. Public generation is off;
no real model provider was called during this deployment.
