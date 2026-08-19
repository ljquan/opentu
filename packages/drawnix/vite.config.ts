/// <reference types='vitest' />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import dts from 'vite-plugin-dts';
import * as path from 'path';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';
import packageJson from './package.json';
import fs from 'fs';

// Read version from public/version.json (shared with web app)
const versionPath = path.resolve(
  __dirname,
  '../../apps/web/public/version.json'
);
let appVersion = packageJson.version;

try {
  if (fs.existsSync(versionPath)) {
    const versionContent = fs.readFileSync(versionPath, 'utf-8');
    const versionJson = JSON.parse(versionContent);
    if (versionJson.version) {
      appVersion = versionJson.version;
      // console.log(`[Drawnix] Loaded version from shared version.json: ${appVersion}`);
    }
  }
} catch (e) {
  console.warn(
    '[Drawnix] Failed to read shared version.json, falling back to package.json version',
    e
  );
}

export default defineConfig({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/packages/drawnix',

  plugins: [
    react(),
    nxViteTsPaths(),
    dts({
      entryRoot: 'src',
      tsconfigPath: path.join(__dirname, 'tsconfig.lib.json'),
    }),
  ],

  // Inject version number as environment variable
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(appVersion),
    __APP_VERSION__: JSON.stringify(appVersion),
    // Vue feature flags - Crepe 内部使用了 Vue，需要定义这些编译时标志
    __VUE_OPTIONS_API__: JSON.stringify(false),
    __VUE_PROD_DEVTOOLS__: JSON.stringify(false),
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: JSON.stringify(false),
  },

  resolve: {
    dedupe: ['react', 'react-dom'],
  },

  // Uncomment this if you are using workers.
  // worker: {
  //  plugins: [ nxViteTsPaths() ],
  // },

  // Configuration for building your library.
  // See: https://vitejs.dev/guide/build.html#library-mode
  build: {
    outDir: '../../dist/drawnix',
    emptyOutDir: true,
    reportCompressedSize: true,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
    lib: {
      entry: {
        index: 'src/index.ts',
        runtime: 'src/runtime.ts',
      },
      name: 'drawnix',
      fileName: (format, entryName) => entryName,
      // Change this to the formats you want to support.
      // Don't forget to update your package.json as well.
      formats: ['es', 'cjs'],
    },
    rollupOptions: {
      // External packages that should not be bundled into your library.
      external: [
        'react',
        'react-dom',
        'react/jsx-runtime',
        '@plait-board/react-board',
        '@plait-board/mermaid-to-drawnix',
        'classnames',
        'open-color',
        '@floating-ui/react',
        '@plait/core',
        '@plait/common',
        '@plait/draw',
        '@plait/mind',
        '@plait/mind',
        'roughjs/bin/core',
        '@plait/text-plugins',
      ],
    },
  },

  test: {
    globals: true,
    cache: {
      dir: '../../node_modules/.vitest',
    },
    environment: 'jsdom',
    include: ['src/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../coverage/packages/drawnix',
      provider: 'v8',
    },
  },
});
