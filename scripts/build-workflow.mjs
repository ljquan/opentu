import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const web = resolve(root, 'packages/drawnix/src/workflow-mode/web');
const result = spawnSync(
  process.execPath,
  [
    resolve(web, 'node_modules/vite/bin/vite.js'),
    'build',
    '--outDir',
    resolve(root, 'apps/web/public/workflow-app'),
  ],
  {
    cwd: web,
    env: { ...process.env, VITE_EMBEDDED: 'true', VITE_BASE: '/workflow-app/' },
    stdio: 'inherit',
  }
);
if (result.error) console.error(result.error);
process.exit(result.status ?? 1);
