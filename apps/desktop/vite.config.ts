import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';
import path from 'path';

const workspaceRoot = path.resolve(__dirname, '../..');
const webSrcPath = path.resolve(workspaceRoot, 'apps/web/src');

export default defineConfig({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/apps/desktop',
  base: './',

  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production'),
    __APP_VERSION__: JSON.stringify('0.1.0'),
    __VUE_OPTIONS_API__: JSON.stringify(false),
    __VUE_PROD_DEVTOOLS__: JSON.stringify(false),
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: JSON.stringify(false),
  },

  server: {
    port: 7201,
    host: 'localhost',
    strictPort: true,
  },

  resolve: {
    alias: [
      {
        find: /^\.\.\/web\/src\/(.+)$/,
        replacement: path.resolve(webSrcPath, '$1'),
      },
    ],
    dedupe: ['react', 'react-dom'],
  },

  build: {
    outDir: 'dist',
    emptyOutDir: true,
    reportCompressedSize: true,
    modulePreload: false,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
        },
      },
    },
  },

  plugins: [react(), nxViteTsPaths()],
});