import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  root: __dirname,
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.spec.ts', 'src/**/*.spec.tsx'],
    maxWorkers: 2,
  },
  resolve: {
    alias: {
      '@aitu/utils/security': path.resolve(
        __dirname,
        '../../packages/utils/src/security/index.ts'
      ),
      '@drawnix/drawnix/types/shared/core.types': path.resolve(
        __dirname,
        '../../packages/drawnix/src/types/shared/core.types.ts'
      ),
    },
  },
});
