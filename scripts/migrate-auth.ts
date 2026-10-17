import { getMigrations } from 'better-auth/db/migration';
import { getLocalAuth, closeLocalAuth } from '../api/_lib/local-auth';
async function main() {
  try {
    const migration = await getMigrations(getLocalAuth().options);
    await migration.runMigrations();
    console.log('Independent account schema migration completed.');
  } finally { await closeLocalAuth(); }
}
main().catch(() => { console.error('Account migration failed.'); process.exitCode = 1; });
