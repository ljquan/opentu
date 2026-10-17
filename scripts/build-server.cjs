const path = require('node:path');
const esbuild = require(require.resolve('esbuild', { paths: [path.dirname(require.resolve('vite'))] }));
esbuild.buildSync({ entryPoints: ['scripts/serve-api.ts'], bundle: true, platform: 'node', target: 'node22', format: 'cjs', external: ['pg-native'], outfile: 'dist/server/api.cjs' });
esbuild.buildSync({ entryPoints: ['scripts/integration-smoke.ts'], bundle: true, platform: 'node', target: 'node22', format: 'cjs', external: ['pg-native'], outfile: 'dist/server/integration-smoke.cjs' });
esbuild.buildSync({ entryPoints: ['scripts/migrate-auth.ts'], bundle: true, platform: 'node', target: 'node22', format: 'cjs', external: ['pg-native'], outfile: 'dist/server/migrate-auth.cjs' });
esbuild.buildSync({ entryPoints: ['scripts/auth-smoke.ts'], bundle: true, platform: 'node', target: 'node22', format: 'cjs', external: ['pg-native'], outfile: 'dist/server/auth-smoke.cjs' });
