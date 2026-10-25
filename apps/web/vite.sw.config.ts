import { defineConfig } from 'vite';
import path from 'path';
import fs from 'fs';

// Read version from public/version.json
const versionPath = path.resolve(__dirname, 'public/version.json');
let appVersion = '0.0.0';

try {
  if (fs.existsSync(versionPath)) {
    const versionContent = fs.readFileSync(versionPath, 'utf-8');
    const versionJson = JSON.parse(versionContent);
    appVersion = versionJson.version || '0.0.0';
    console.log(`[Vite SW] Loaded version from version.json: ${appVersion}`);
  } else {
    console.warn('[Vite SW] version.json not found at', versionPath);
  }
} catch (e) {
  console.error('[Vite SW] Failed to read version.json', e);
}

export default defineConfig(({ mode }) => {
  const isDev = mode === 'development';
  
  return {
    root: __dirname,
    publicDir: false, // 禁用 publicDir，避免将 public 目录下的文件复制到 outDir (也是 public)
    resolve: {
      alias: {
        '@aitu/utils': path.resolve(__dirname, '../../packages/utils/src/index.ts'),
      },
    },
    define: {
      __APP_VERSION__: JSON.stringify(appVersion),
    },
    build: {
      // Dev mode: output to public so dev server can serve it
      // Prod mode: output to dist
      outDir: isDev ? 'public' : '../../dist/apps/web',
      emptyOutDir: false, // Don't empty outDir as it might contain other files
      lib: {
        entry: 'src/sw/index.ts',
        name: 'sw',
        formats: ['iife'],
        fileName: () => 'sw.js'
      },
      rollupOptions: {
        output: {
          entryFileNames: 'sw.js',
          assetFileNames: '[name].[ext]',
        }
      },
      minify: !isDev,
      sourcemap: isDev
    }
  };
});
