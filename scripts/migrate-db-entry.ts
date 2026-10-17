import { migrateSchema, closeDatabase } from '../api/_lib/db';

async function main() {
  try {
    await migrateSchema();
    console.log('Database migration completed.');
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code && /^[A-Z0-9_]{2,40}$/.test(code)) console.error(`Database error code: ${code}`);
    console.error('Database migration failed; check access and migration permissions.');
    process.exitCode = 1;
  } finally {
    await closeDatabase();
  }
}
void main();
