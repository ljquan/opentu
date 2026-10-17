# PostgreSQL deployment

Verified on aliyun-server, 2026-09-06.

- Ubuntu package PostgreSQL 14.24, managed by postgresql@14-main; boot enabled.
- Loopback connections only, port 5432. No public database endpoint.
- Database: opentu. Owner/migration role: opentu_migrator. Runtime role: opentu_app.
- Runtime role has business-table DML, schema usage, migration-version read access. No superuser, role creation, database creation or schema creation privileges.
- Secrets: /etc/opentu/database-secrets.json; migration.env and runtime.env in the same directory, root-only permissions. Never copy them into the repository.
- OPENTU_DATABASE_DRIVER=postgres selects TCP pg driver. Neon remains the default. Loopback TCP is unencrypted; remote database connections require TLS.
- Real migration completed at version 20260906-free-launch-v2. Runtime write test rolled back; schema CREATE privilege verified false.
- pg_dump custom-format backup created in /var/backups/opentu; restored successfully to isolated opentu_restore_check database.
- Daily backup at 03:15 server time via /etc/cron.d/opentu-postgres-backup. Backups remain on the same host; off-host backup and retention must be configured before production growth.
- Public generation remains disabled. This database deployment is not confirmation of working public login, registration, API hosting or generation. The earlier proposed nip.io address has not been published by this step.

Migration bundle: /root/opentu-migrate.cjs. Run with node --env-file=/etc/opentu/migration.env /root/opentu-migrate.cjs. Runtime must use runtime.env, never migration.env.
