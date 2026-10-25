import { copyFile, mkdir } from 'node:fs/promises';

// These browser-native ES modules are also served directly by sw-debug.
// Publish the same sources and declarations without transpiling or duplicating them.
const source = new URL('../apps/web/public/sw-debug/shared/', import.meta.url);
const output = new URL('../dist/backup-core/', import.meta.url);
await mkdir(output, { recursive: true });
for (const name of ['backup-core', 'backup-part-manager-core']) {
  for (const extension of ['js', 'd.ts']) {
    await copyFile(
      new URL(`${name}.${extension}`, source),
      new URL(`${name}.${extension}`, output)
    );
  }
}
