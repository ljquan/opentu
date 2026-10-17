const path = require('node:path');
require('ts-node').register({
  project: path.join(__dirname, '../api/tsconfig.json'),
  transpileOnly: true,
  compilerOptions: { module: 'CommonJS' },
});
const { migrateSchema, closeDatabase } = require('../api/_lib/db.ts');

(async () => {
  try {
    await migrateSchema();
    console.log('FoxVue database migration completed.');
  } catch {
    console.error('Database migration failed. Check database access and migration-role permissions.');
    process.exitCode = 1;
  } finally {
    await closeDatabase();
  }
})();
