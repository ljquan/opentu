/// <reference types='vitest' />
import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { visualizer } from 'rollup-plugin-visualizer';

// Read version from public/version.json
const versionPath = path.resolve(__dirname, 'public/version.json');
let appVersion = '0.0.0';

try {
  if (fs.existsSync(versionPath)) {
    const versionContent = fs.readFileSync(versionPath, 'utf-8');
    const versionJson = JSON.parse(versionContent);
    appVersion = versionJson.version || '0.0.0';
    console.log(`[Vite] Loaded version from version.json: ${appVersion}`);
  } else {
    console.warn('[Vite] version.json not found at', versionPath);
  }
} catch (e) {
  console.error('[Vite] Failed to read version.json', e);
}

/**
 * Vite 插件：生成 precache-manifest.json
 * 在构建完成后扫描输出目录，生成需要预缓存的静态资源清单
 */
function precacheManifestPlugin(): Plugin {
  return {
    name: 'precache-manifest',
    apply: 'build',
    closeBundle: {
      sequential: true,
      order: 'post',
      async handler() {
        const outDir = path.resolve(__dirname, '../../dist/apps/web');
        
        // 需要预缓存的文件扩展名
        const PRECACHE_EXTENSIONS = ['.js', '.css', '.html', '.json', '.svg', '.ico'];
        // 排除的文件模式
        const EXCLUDE_PATTERNS = [
          /stats\.html$/,           // Vite visualizer
          /\.map$/,                 // Source maps
          /precache-manifest\.json$/, // 自身
          /sw\.js$/,                // Service Worker 本身不需要预缓存
          /sw-debug\.html$/,        // 调试面板，仅在访问时加载
          /changelog\.json$/,       // 版本日志，需要始终获取最新
          /version\.json$/,         // 版本信息，需要始终获取最新
        ];
        // 总是包含的关键文件
        const ALWAYS_INCLUDE = [
          '/index.html',
          '/manifest.json',
          '/favicon.ico',
        ];

        const manifest: { url: string; revision: string }[] = [];

        // 递归扫描目录
        function scanDir(dir: string, base = '') {
          if (!fs.existsSync(dir)) return;
          
          const entries = fs.readdirSync(dir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            const relativePath = path.join(base, entry.name).replace(/\\/g, '/');
            
            if (entry.isDirectory()) {
              // 跳过不需要预缓存的目录
              // - product_showcase, help_tooltips: 大型资源目录
              // - sw-debug: 调试面板，仅在访问 /sw-debug.html 时加载
              if (!['product_showcase', 'help_tooltips', 'sw-debug'].includes(entry.name)) {
                scanDir(fullPath, relativePath);
              }
            } else if (entry.isFile()) {
              const ext = path.extname(entry.name).toLowerCase();
              const url = '/' + relativePath;
              
              // 检查是否应该排除
              const shouldExclude = EXCLUDE_PATTERNS.some(pattern => pattern.test(url));
              if (shouldExclude) continue;
              
              // 检查是否是需要预缓存的文件类型
              const shouldInclude = PRECACHE_EXTENSIONS.includes(ext) || 
                                   ALWAYS_INCLUDE.includes(url);
              
              if (shouldInclude) {
                // 计算文件哈希作为 revision
                const content = fs.readFileSync(fullPath);
                const hash = crypto.createHash('md5').update(new Uint8Array(content)).digest('hex').substring(0, 8);
                
                manifest.push({ url, revision: hash });
              }
            }
          }
        }

        scanDir(outDir);
        
        // 按 URL 排序，便于调试
        manifest.sort((a, b) => a.url.localeCompare(b.url));

        // 写入 manifest 文件
        const manifestPath = path.join(outDir, 'precache-manifest.json');
        const manifestContent = {
          version: appVersion,
          timestamp: new Date().toISOString(),
          files: manifest,
        };
        
        fs.writeFileSync(manifestPath, JSON.stringify(manifestContent, null, 2));
        console.log(`[Precache] Generated manifest with ${manifest.length} files`);
      }
    }
  };
}

// 检测是否在 watch 模式下运行（命令行包含 --watch）
const isWatchMode = process.argv.includes('--watch');

export default defineConfig({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/apps/web',

  // 使用相对路径，源站始终可用，CDN 加速由 SW 层处理
  // SW 的 handleStaticRequest: cache → CDN → 源站回退
  base: process.env.VITE_BASE_URL || './',

  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(appVersion),
    __APP_VERSION__: JSON.stringify(appVersion),
    // Vue feature flags - @milkdown/crepe 内部使用了 Vue，需要定义这些编译时标志
    __VUE_OPTIONS_API__: JSON.stringify(false),
    __VUE_PROD_DEVTOOLS__: JSON.stringify(false),
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: JSON.stringify(false),
  },

  server: {
    port: 7200,
    host: 'localhost',
    headers: {
      'Content-Security-Policy': "upgrade-insecure-requests; default-src 'self' https: data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com https://www.google-analytics.com https://us.i.posthog.com https://us-assets.i.posthog.com https://wiki.tu-zi.com; worker-src 'self' blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' https: wss: data:; frame-ancestors 'self' localhost:* 127.0.0.1:* https://api.tu-zi.com;"
    }
  },

  preview: {
    port: 4300,
    host: 'localhost',
    headers: {
      'Content-Security-Policy': "upgrade-insecure-requests; default-src 'self' https: data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com https://www.google-analytics.com https://us.i.posthog.com https://us-assets.i.posthog.com https://wiki.tu-zi.com; worker-src 'self' blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' https: wss: data:; frame-ancestors 'self' localhost:* 127.0.0.1:* https://api.tu-zi.com;"
    }
  },

  plugins: [
    react(),
    nxViteTsPaths(),
    visualizer({
      open: false,
      filename: path.resolve(__dirname, '../../dist/apps/web/stats.html'),
      gzipSize: true,
      brotliSize: true,
    }),
    precacheManifestPlugin(),
  ],

  // Uncomment this if you are using workers.
  // worker: {
  //  plugins: [ nxViteTsPaths() ],
  // },

  build: {
    outDir: '../../dist/apps/web',
    // watch 模式下不清空输出目录，避免 index.html 丢失导致 serve 失败
    emptyOutDir: !isWatchMode,
    reportCompressedSize: true,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
});
