// Run as root on the application host after installing PostgreSQL.
const fs = require('node:fs');
const { randomBytes } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const directory = '/etc/opentu';
fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
const secretPath = `${directory}/database-secrets.json`;
let secrets;
if (fs.existsSync(secretPath)) {
  secrets = JSON.parse(fs.readFileSync(secretPath, 'utf8'));
} else {
  secrets = Object.fromEntries(['migration', 'runtime', 'encryption', 'cron'].map((key) => [key, randomBytes(32).toString('hex')]));
  fs.writeFileSync(secretPath, JSON.stringify(secrets), { mode: 0o600, flag: 'wx' });
}
function sql(statement, database = 'postgres') {
  return execFileSync('runuser', ['-u', 'postgres', '--', 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-At', '-d', database], { input: statement, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
}
for (const [role, password] of [['opentu_migrator', secrets.migration], ['opentu_app', secrets.runtime]]) {
  if (!sql(`SELECT 1 FROM pg_roles WHERE rolname = '${role}'`)) {
    sql(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE CONNECTION LIMIT 10`);
  }
}
if (!sql("SELECT 1 FROM pg_database WHERE datname = 'opentu'")) {
  sql('CREATE DATABASE opentu OWNER opentu_migrator');
}
sql('REVOKE ALL ON DATABASE opentu FROM PUBLIC; GRANT CONNECT ON DATABASE opentu TO opentu_app;');
sql('REVOKE CREATE ON SCHEMA public FROM PUBLIC; GRANT USAGE, CREATE ON SCHEMA public TO opentu_migrator; GRANT USAGE ON SCHEMA public TO opentu_app;', 'opentu');
const common = `NODE_ENV=production\nOPENTU_DATABASE_DRIVER=postgres\nOPENTU_PUBLIC_GENERATION_ENABLED=false\nVITE_OPENTU_SERVER_CATALOG=true\nVITE_OPENTU_MANAGED_GENERATION=true\nOPENTU_PROVIDER_ENCRYPTION_KEY=${secrets.encryption}\nCRON_SECRET=${secrets.cron}\nTUZI_SESSION_API_BASE_URL=https://api.tu-zi.com\n`;
for (const [name, role, password] of [['migration', 'opentu_migrator', secrets.migration], ['runtime', 'opentu_app', secrets.runtime]]) {
  const target = `${directory}/${name}.env`;
  if (!fs.existsSync(target)) fs.writeFileSync(target, `${common}POSTGRES_URL=postgresql://${role}:${password}@127.0.0.1:5432/opentu?sslmode=disable\n`, { mode: 0o600, flag: 'wx' });
}
sql("ALTER SYSTEM SET listen_addresses = 'localhost';");
sql("ALTER SYSTEM SET max_connections = '30';");
sql("ALTER SYSTEM SET work_mem = '4MB';");
sql("ALTER SYSTEM SET idle_in_transaction_session_timeout = '60s';");
console.log('Database roles and protected environment files are ready. Secrets were not printed.');
