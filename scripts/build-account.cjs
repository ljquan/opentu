const fs = require('node:fs');
const path = require('node:path');
const esbuild = require(require.resolve('esbuild', { paths: [path.dirname(require.resolve('vite'))] }));
esbuild.buildSync({ entryPoints: ['apps/web/src/account/bootstrap.tsx'], bundle: true, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, minify: true, outfile: 'dist/account/account.js' });
fs.mkdirSync('dist/account/icons', { recursive: true });
fs.copyFileSync('scripts/account-index.html', 'dist/account/index.html');
fs.copyFileSync('apps/web/public/icons/foxvue-mark.png', 'dist/account/icons/foxvue-mark.png');
