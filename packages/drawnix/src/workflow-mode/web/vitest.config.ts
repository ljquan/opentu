import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
    root: fileURLToPath(new URL('.', import.meta.url)),
    esbuild: { jsx: 'automatic' },
    define: {
        'import.meta.env.VITE_APP_VERSION': JSON.stringify('1.0.0'),
        __APP_CHANGELOG__: JSON.stringify({ versions: [{ version: '1.0.0', date: '2026-09-25', changes: { fixes: ['Local release'] } }] }),
    },
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    test: {
        environment: 'jsdom',
        environmentOptions: { jsdom: { url: 'http://localhost/' } },
        setupFiles: ['./tests/setup.ts'],
        include: ['tests/model-defaults.test.ts', 'tests/native-*.test.{ts,tsx}', 'tests/document-*.test.{ts,tsx}'],
    },
});
