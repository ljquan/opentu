import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    test: { environment: 'jsdom', include: ['tests/model-defaults.test.ts', 'tests/native-*.test.{ts,tsx}'] },
});
