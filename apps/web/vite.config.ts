/// <reference types='vitest' />
import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createRequire } from 'module';
import { visualizer } from 'rollup-plugin-visualizer';

const require = createRequire(import.meta.url);
const workspaceRoot = path.resolve(__dirname, '../..');

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

const IDLE_PREFETCH_GROUPS = [
  'ai-chat',
  'tool-windows',
  'diagram-engines',
  'office-data',
  'editor-engines',
  'media-viewer',
  'external-skills',
  'runtime-static-assets',
  'offline-static-assets',
] as const;

const IDLE_PREFETCH_DEFAULTS = [
  'tool-windows',
  'runtime-static-assets',
] as const;

type IdlePrefetchGroup = (typeof IDLE_PREFETCH_GROUPS)[number];

type ManifestEntry = { url: string; revision: string };
type OutputAsset = {
  type: 'asset';
  fileName: string;
  source?: string | Uint8Array;
};
type OutputChunk = {
  type: 'chunk';
  fileName: string;
  code: string;
  facadeModuleId: string | null;
  modules: Record<string, unknown>;
  referencedFiles: string[];
  imports: string[];
  dynamicImports: string[];
};
type OutputBundle = Record<string, OutputAsset | OutputChunk>;
type ViteOutputChunk = OutputChunk & {
  viteMetadata?: {
    importedCss?: Set<string>;
  };
};

const STATIC_SCAN_EXCLUDED_DIRS = new Set([
  'product_showcase',
  'help_tooltips',
  'sw-debug',
]);

const STATIC_SCAN_EXCLUDED_PATTERNS = [
  /stats\.html$/,
  /\.map$/,
  /precache-manifest\.json$/,
  /idle-prefetch-manifest\.json$/,
  /sw\.js$/,
  /sw-debug\.html$/,
  /changelog\.json$/,
  /version\.json$/,
];

const PRECACHE_EXTENSIONS = new Set(['.js', '.css', '.json', '.svg', '.ico']);
const POST_BOOT_PREFETCH_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.avif',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.wasm',
  '.txt',
  '.md',
]);
const PRECACHE_ALWAYS_INCLUDE = new Set([
  '/index.html',
  '/manifest.json',
  '/favicon.ico',
]);

function isFileDescriptorLimitError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    ((error as NodeJS.ErrnoException).code === 'EMFILE' ||
      (error as NodeJS.ErrnoException).code === 'ENFILE')
  );
}

function waitForFileDescriptorRetry(attempt: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 120 * (attempt + 1));
  });
}

async function readFileWithFdRetry(
  fullPath: string,
  encoding?: BufferEncoding
): Promise<string | Buffer> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      return encoding
        ? await fs.promises.readFile(fullPath, encoding)
        : await fs.promises.readFile(fullPath);
    } catch (error) {
      lastError = error;
      if (!isFileDescriptorLimitError(error) || attempt === 5) {
        throw error;
      }
      await waitForFileDescriptorRetry(attempt);
    }
  }

  throw lastError;
}

async function writeFileWithFdRetry(
  fullPath: string,
  content: string
): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await fs.promises.writeFile(fullPath, content);
      return;
    } catch (error) {
      if (!isFileDescriptorLimitError(error) || attempt === 5) {
        throw error;
      }
      await waitForFileDescriptorRetry(attempt);
    }
  }
}

function createRevision(fullPath: string): string {
  const content = fs.readFileSync(fullPath);
  return crypto
    .createHash('md5')
    .update(new Uint8Array(content))
    .digest('hex')
    .substring(0, 8);
}

async function createRevisionWithFdRetry(fullPath: string): Promise<string> {
  const content = await readFileWithFdRetry(fullPath);
  return crypto
    .createHash('md5')
    .update(new Uint8Array(content as Buffer))
    .digest('hex')
    .substring(0, 8);
}

function createContentRevision(content: string | Uint8Array): string {
  return crypto.createHash('md5').update(content).digest('hex').substring(0, 8);
}

function createBundleFileRevision(file: OutputAsset | OutputChunk): string {
  if (file.type === 'asset') {
    const source = file.source ?? '';
    return createContentRevision(
      typeof source === 'string' || source instanceof Uint8Array
        ? source
        : String(source)
    );
  }

  return createContentRevision(file.code);
}

function shouldExcludeStaticScanUrl(url: string): boolean {
  return STATIC_SCAN_EXCLUDED_PATTERNS.some((pattern) => pattern.test(url));
}

function isRuntimeStaticAssetUrl(url: string): boolean {
  // 仅覆盖构建产物中的运行时附属资源，避免把手册截图等大文件带进默认 idle 预取。
  return url.startsWith('/assets/');
}

function collectStaticEntries(
  outDir: string,
  shouldInclude: (url: string, ext: string) => boolean
): ManifestEntry[] {
  const manifest: ManifestEntry[] = [];

  function scanDir(dir: string, base = '') {
    if (!fs.existsSync(dir)) return;

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.join(base, entry.name).replace(/\\/g, '/');

      if (entry.isDirectory()) {
        if (!STATIC_SCAN_EXCLUDED_DIRS.has(entry.name)) {
          scanDir(fullPath, relativePath);
        }
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const ext = path.extname(entry.name).toLowerCase();
      const url = '/' + relativePath;

      if (shouldExcludeStaticScanUrl(url) || !shouldInclude(url, ext)) {
        continue;
      }

      manifest.push({
        url,
        revision: createRevision(fullPath),
      });
    }
  }

  scanDir(outDir);
  manifest.sort((a, b) => a.url.localeCompare(b.url));
  return manifest;
}

function normalizeStaticUrlCandidate(candidate: string): string | null {
  if (!candidate) {
    return null;
  }

  if (
    candidate.startsWith('http://') ||
    candidate.startsWith('https://') ||
    candidate.startsWith('data:') ||
    candidate.startsWith('blob:')
  ) {
    return null;
  }

  const [withoutQuery] = candidate.split(/[?#]/, 1);
  if (!withoutQuery) {
    return null;
  }

  if (withoutQuery.startsWith('./')) {
    return `/${withoutQuery.slice(2)}`;
  }

  if (withoutQuery.startsWith('/')) {
    return withoutQuery;
  }

  return `/${withoutQuery}`;
}

async function collectSelectedEntries(
  outDir: string,
  urls: Iterable<string>,
  shouldInclude: (url: string, ext: string) => boolean
): Promise<ManifestEntry[]> {
  const manifest: ManifestEntry[] = [];
  const normalizedUrls = new Set<string>();

  for (const url of urls) {
    const normalizedUrl = normalizeStaticUrlCandidate(url);
    if (!normalizedUrl) {
      continue;
    }

    normalizedUrls.add(normalizedUrl);
  }

  for (const url of normalizedUrls) {
    const ext = path.extname(url).toLowerCase();
    if (shouldExcludeStaticScanUrl(url) || !shouldInclude(url, ext)) {
      continue;
    }

    const fullPath = path.join(outDir, url.replace(/^\//, ''));
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) {
      continue;
    }

    manifest.push({
      url,
      revision: await createRevisionWithFdRetry(fullPath),
    });
  }

  manifest.sort((a, b) => a.url.localeCompare(b.url));
  return manifest;
}

async function collectHtmlShellPrecacheUrls(
  indexHtmlPath: string
): Promise<Set<string>> {
  const urls = new Set<string>(PRECACHE_ALWAYS_INCLUDE);

  if (!fs.existsSync(indexHtmlPath)) {
    return urls;
  }

  const html = (await readFileWithFdRetry(indexHtmlPath, 'utf8')) as string;
  const attrPattern = /\b(?:data-local-(?:src|href)|src|href)="([^"]+)"/g;

  for (const match of html.matchAll(attrPattern)) {
    const normalizedUrl = normalizeStaticUrlCandidate(match[1]);
    if (normalizedUrl) {
      urls.add(normalizedUrl);
    }
  }

  return urls;
}

function normalizePathForChunking(id: string): string {
  return id.replace(/\\/g, '/');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function findPackageRoot(entryPath: string): string {
  let current = fs.statSync(entryPath).isDirectory()
    ? entryPath
    : path.dirname(entryPath);

  while (current !== path.dirname(current)) {
    if (fs.existsSync(path.join(current, 'package.json'))) {
      return current;
    }

    current = path.dirname(current);
  }

  throw new Error(`Unable to resolve package root for ${entryPath}`);
}

function resolvePackageRoot(packageName: string, fromPaths: string[]): string {
  return findPackageRoot(require.resolve(packageName, { paths: fromPaths }));
}

function createPackageRootAlias(packageName: string, packageRoot: string) {
  const escapedName = escapeRegExp(packageName);

  return [
    { find: new RegExp(`^${escapedName}$`), replacement: packageRoot },
    {
      find: new RegExp(`^${escapedName}/(.+)$`),
      replacement: `${packageRoot}/$1`,
    },
  ];
}

const mermaidToDrawnixPackageRoot = resolvePackageRoot(
  '@plait-board/mermaid-to-drawnix',
  [workspaceRoot]
);
const diagramEngineAliases = [
  ...createPackageRootAlias(
    'mermaid',
    resolvePackageRoot('mermaid', [mermaidToDrawnixPackageRoot])
  ),
];

function normalizeBundleFileName(fileName: string): string {
  return normalizePathForChunking(fileName).replace(/^\.\//, '');
}

function toManifestUrl(fileName: string): string {
  const normalizedFileName = normalizeBundleFileName(fileName);
  return normalizedFileName.startsWith('/')
    ? normalizedFileName
    : `/${normalizedFileName}`;
}

function shouldIncludeIdlePrefetchBundleFile(fileName: string): boolean {
  const normalizedFileName = normalizeBundleFileName(fileName).toLowerCase();
  return (
    normalizedFileName.endsWith('.js') || normalizedFileName.endsWith('.css')
  );
}

function isNamedIdlePrefetchGroupFile(
  fileName: string,
  group: IdlePrefetchGroup
): boolean {
  const baseName = path.posix
    .basename(normalizeBundleFileName(fileName))
    .toLowerCase();
  return baseName.startsWith(`${group.toLowerCase()}-`);
}

function getNamedIdlePrefetchGroupForFile(
  fileName: string
): IdlePrefetchGroup | undefined {
  return IDLE_PREFETCH_GROUPS.find((group) =>
    isNamedIdlePrefetchGroupFile(fileName, group)
  );
}

function collectNamedGroupEntriesFromOutputDir(
  assetsDir: string,
  group: IdlePrefetchGroup
): ManifestEntry[] {
  if (!fs.existsSync(assetsDir)) {
    return [];
  }

  const files = fs.readdirSync(assetsDir);
  const entries: ManifestEntry[] = [];

  for (const file of files) {
    const normalizedFileName = normalizeBundleFileName(file);
    if (
      !isNamedIdlePrefetchGroupFile(normalizedFileName, group) ||
      !shouldIncludeIdlePrefetchBundleFile(normalizedFileName)
    ) {
      continue;
    }

    const fullPath = path.join(assetsDir, file);
    entries.push({
      url: toManifestUrl(path.posix.join('assets', normalizedFileName)),
      revision: createRevision(fullPath),
    });
  }

  entries.sort((a, b) => a.url.localeCompare(b.url));
  return entries;
}

function chunkBelongsToIdlePrefetchGroup(
  chunk: ViteOutputChunk,
  group: IdlePrefetchGroup
): boolean {
  if (isNamedIdlePrefetchGroupFile(chunk.fileName, group)) {
    return true;
  }

  const moduleIds = [chunk.facadeModuleId, ...Object.keys(chunk.modules)];
  return moduleIds.some(
    (moduleId) =>
      typeof moduleId === 'string' &&
      resolveIdlePrefetchGroup(moduleId) === group
  );
}

function collectIdlePrefetchGroupEntriesFromBundle(
  bundle: OutputBundle,
  group: IdlePrefetchGroup
): ManifestEntry[] {
  if (group === 'runtime-static-assets' || group === 'offline-static-assets') {
    return [];
  }

  const chunksByFileName = new Map<string, ViteOutputChunk>();
  const assetsByFileName = new Map<string, OutputAsset>();

  for (const output of Object.values(bundle)) {
    const normalizedFileName = normalizeBundleFileName(output.fileName);

    if (output.type === 'chunk') {
      chunksByFileName.set(normalizedFileName, output as ViteOutputChunk);
      continue;
    }

    assetsByFileName.set(normalizedFileName, output);
  }

  const pendingChunkFileNames = Array.from(chunksByFileName.values())
    .filter((chunk) => chunkBelongsToIdlePrefetchGroup(chunk, group))
    .map((chunk) => normalizeBundleFileName(chunk.fileName));

  if (pendingChunkFileNames.length === 0) {
    return [];
  }

  const visitedChunkFileNames = new Set<string>();
  const pendingCssFileNames = new Set<string>();
  const entriesByUrl = new Map<string, ManifestEntry>();

  const addBundleEntry = (file: OutputAsset | OutputChunk) => {
    if (!shouldIncludeIdlePrefetchBundleFile(file.fileName)) {
      return;
    }

    const entry = {
      url: toManifestUrl(file.fileName),
      revision: createBundleFileRevision(file),
    };
    entriesByUrl.set(entry.url, entry);
  };

  while (pendingChunkFileNames.length > 0) {
    const currentFileName = pendingChunkFileNames.pop();
    if (!currentFileName || visitedChunkFileNames.has(currentFileName)) {
      continue;
    }

    visitedChunkFileNames.add(currentFileName);

    const chunk = chunksByFileName.get(currentFileName);
    if (!chunk) {
      continue;
    }

    addBundleEntry(chunk);

    chunk.viteMetadata?.importedCss?.forEach((cssFileName) => {
      pendingCssFileNames.add(normalizeBundleFileName(cssFileName));
    });

    chunk.referencedFiles.forEach((referencedFileName) => {
      const normalizedReferencedFileName =
        normalizeBundleFileName(referencedFileName);
      if (normalizedReferencedFileName.toLowerCase().endsWith('.css')) {
        pendingCssFileNames.add(normalizedReferencedFileName);
      }
    });

    for (const importedFileName of [
      ...chunk.imports,
      ...chunk.dynamicImports,
    ]) {
      const normalizedImportedFileName =
        normalizeBundleFileName(importedFileName);
      const importedGroup = getNamedIdlePrefetchGroupForFile(
        normalizedImportedFileName
      );

      if (importedGroup && importedGroup !== group) {
        continue;
      }

      if (!visitedChunkFileNames.has(normalizedImportedFileName)) {
        pendingChunkFileNames.push(normalizedImportedFileName);
      }
    }
  }

  for (const cssFileName of pendingCssFileNames) {
    const cssAsset = assetsByFileName.get(cssFileName);
    if (cssAsset) {
      addBundleEntry(cssAsset);
    }
  }

  for (const asset of assetsByFileName.values()) {
    if (
      isNamedIdlePrefetchGroupFile(asset.fileName, group) &&
      asset.fileName.toLowerCase().endsWith('.css')
    ) {
      addBundleEntry(asset);
    }
  }

  return Array.from(entriesByUrl.values()).sort((a, b) =>
    a.url.localeCompare(b.url)
  );
}

function resolveIdlePrefetchGroup(id: string): IdlePrefetchGroup | undefined {
  const normalizedId = normalizePathForChunking(id);

  if (
    normalizedId.includes('/packages/drawnix/src/components/chat-drawer/') ||
    normalizedId.includes('/packages/drawnix/src/hooks/useChatHandler') ||
    normalizedId.includes('/packages/drawnix/src/services/chat-service') ||
    normalizedId.includes(
      '/packages/drawnix/src/services/chat-storage-service'
    ) ||
    normalizedId.includes('/packages/drawnix/src/types/chat.types') ||
    normalizedId.includes('/packages/drawnix/src/types/chat-ui.types')
  ) {
    return 'ai-chat';
  }

  if (
    normalizedId.includes('/node_modules/.pnpm/mermaid@') ||
    normalizedId.includes('/node_modules/mermaid/') ||
    normalizedId.includes('/node_modules/.pnpm/elkjs@') ||
    normalizedId.includes('/node_modules/elkjs/') ||
    normalizedId.includes('/node_modules/.pnpm/cytoscape@') ||
    normalizedId.includes('/node_modules/cytoscape/') ||
    normalizedId.includes('/node_modules/.pnpm/layout-base@') ||
    normalizedId.includes('/node_modules/layout-base/') ||
    normalizedId.includes('/node_modules/.pnpm/cose-base@') ||
    normalizedId.includes('/node_modules/cose-base/') ||
    normalizedId.includes('/node_modules/.pnpm/cytoscape-cose-bilkent@') ||
    normalizedId.includes('/node_modules/cytoscape-cose-bilkent/') ||
    normalizedId.includes('/node_modules/.pnpm/dagre-d3-es@') ||
    normalizedId.includes('/node_modules/dagre-d3-es/') ||
    normalizedId.includes('/node_modules/.pnpm/dompurify@') ||
    normalizedId.includes('/node_modules/dompurify/')
  ) {
    return 'diagram-engines';
  }

  if (
    normalizedId.includes('/node_modules/.pnpm/xlsx@') ||
    normalizedId.includes('/node_modules/xlsx/') ||
    normalizedId.includes('/node_modules/.pnpm/jszip@') ||
    normalizedId.includes('/node_modules/jszip/') ||
    normalizedId.includes('/node_modules/.pnpm/pptxgenjs@') ||
    normalizedId.includes('/node_modules/pptxgenjs/')
  ) {
    return 'office-data';
  }

  if (
    normalizedId.includes('/node_modules/.pnpm/@milkdown+') ||
    normalizedId.includes('/node_modules/@milkdown/') ||
    normalizedId.includes('/node_modules/.pnpm/@codemirror+') ||
    normalizedId.includes('/node_modules/@codemirror/') ||
    normalizedId.includes('/node_modules/.pnpm/@lezer+') ||
    normalizedId.includes('/node_modules/@lezer/') ||
    normalizedId.includes('/node_modules/.pnpm/prosemirror-') ||
    normalizedId.includes('/node_modules/prosemirror-') ||
    normalizedId.includes('/node_modules/.pnpm/katex@') ||
    normalizedId.includes('/node_modules/katex/')
  ) {
    return 'editor-engines';
  }

  if (
    normalizedId.includes('/node_modules/.pnpm/viewerjs@') ||
    normalizedId.includes('/node_modules/viewerjs/')
  ) {
    return 'media-viewer';
  }

  if (normalizedId.includes('/packages/drawnix/src/tools/tool-ids.ts')) {
    return undefined;
  }

  if (
    normalizedId.includes(
      '/packages/drawnix/src/components/startup/DrawnixDeferredRuntime.tsx'
    ) ||
    normalizedId.includes(
      '/packages/drawnix/src/components/startup/DeferredMediaLibraryModal.tsx'
    ) ||
    normalizedId.includes(
      '/packages/drawnix/src/components/startup/DeferredSyncSettings.tsx'
    ) ||
    normalizedId.includes(
      '/packages/drawnix/src/services/asset-integration-service'
    ) ||
    normalizedId.includes(
      '/packages/drawnix/src/services/font-manager-service'
    ) ||
    normalizedId.includes('/packages/drawnix/src/hooks/useTaskStorage') ||
    normalizedId.includes('/packages/drawnix/src/hooks/useTaskExecutor') ||
    normalizedId.includes(
      '/packages/drawnix/src/hooks/useAutoInsertToCanvas'
    ) ||
    normalizedId.includes(
      '/packages/drawnix/src/hooks/useImageGenerationAnchorSync'
    ) ||
    normalizedId.includes('/packages/drawnix/src/hooks/useBeforeUnload') ||
    normalizedId.includes('/packages/drawnix/src/hooks/useProviderProfiles') ||
    normalizedId.includes('/packages/drawnix/src/components/toolbox-drawer/') ||
    normalizedId.includes('/packages/drawnix/src/components/project-drawer/') ||
    normalizedId.includes(
      '/packages/drawnix/src/components/toolbar/minimized-tools-bar/'
    ) ||
    normalizedId.includes(
      '/packages/drawnix/src/services/tool-window-service'
    ) ||
    normalizedId.includes('/packages/drawnix/src/services/toolbox-service') ||
    normalizedId.includes('/packages/drawnix/src/tools/') ||
    normalizedId.includes('/packages/drawnix/src/components/backup-restore/') ||
    normalizedId.includes(
      '/packages/drawnix/src/components/performance-panel/'
    ) ||
    normalizedId.includes('/packages/drawnix/src/components/version-update/') ||
    normalizedId.includes(
      '/packages/drawnix/src/components/command-palette/'
    ) ||
    normalizedId.includes('/packages/drawnix/src/components/canvas-search/')
  ) {
    return 'tool-windows';
  }

  if (
    normalizedId.includes(
      '/packages/drawnix/src/generated/external-skills-bundle.json'
    )
  ) {
    return 'external-skills';
  }

  return undefined;
}

function isStartupRuntimeModule(id: string): boolean {
  const normalizedId = normalizePathForChunking(id);
  return (
    normalizedId.includes('vite/preload-helper') ||
    normalizedId.includes('commonjs-dynamic-modules') ||
    normalizedId.includes('commonjsHelpers')
  );
}

interface ManualChunkModuleInfo {
  importers: readonly string[];
}

interface ManualChunkContext {
  getModuleInfo: (id: string) => ManualChunkModuleInfo | null;
}

function isWebMainEntry(id: string): boolean {
  const normalizedId = normalizePathForChunking(id);
  return (
    normalizedId.endsWith('/apps/web/src/main.tsx') ||
    normalizedId.endsWith('/src/main.tsx')
  );
}

function isStaticallyReachableFromWebMain(
  id: string,
  getModuleInfo: ManualChunkContext['getModuleInfo'],
  visited = new Set<string>()
): boolean {
  if (visited.has(id)) {
    return false;
  }
  visited.add(id);

  if (isWebMainEntry(id)) {
    return true;
  }

  const moduleInfo = getModuleInfo(id);
  if (!moduleInfo) {
    return false;
  }

  return moduleInfo.importers.some((importerId) =>
    isStaticallyReachableFromWebMain(importerId, getModuleInfo, visited)
  );
}

function resolveManualChunk(
  id: string,
  context?: ManualChunkContext
): string | undefined {
  if (isStartupRuntimeModule(id)) {
    return 'startup-runtime';
  }

  const group = resolveIdlePrefetchGroup(id);
  if (
    (group === undefined || group === 'tool-windows') &&
    context &&
    isStaticallyReachableFromWebMain(id, context.getModuleInfo)
  ) {
    return 'startup-app';
  }

  return group;
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
        const indexHtmlPath = path.join(outDir, 'index.html');
        const precacheUrls = await collectHtmlShellPrecacheUrls(indexHtmlPath);
        const manifest = await collectSelectedEntries(
          outDir,
          precacheUrls,
          (url, ext) =>
            PRECACHE_ALWAYS_INCLUDE.has(url) ||
            (ext !== '.html' && PRECACHE_EXTENSIONS.has(ext))
        );

        // 写入 manifest 文件
        const manifestPath = path.join(outDir, 'precache-manifest.json');
        const manifestContent = {
          version: appVersion,
          timestamp: new Date().toISOString(),
          files: manifest,
        };

        await writeFileWithFdRetry(
          manifestPath,
          JSON.stringify(manifestContent, null, 2)
        );
        console.log(
          `[Precache] Generated manifest with ${manifest.length} files`
        );
      },
    },
  };
}

function idlePrefetchManifestPlugin(): Plugin {
  let bundleGroupEntries = Object.fromEntries(
    IDLE_PREFETCH_GROUPS.map((group) => [group, [] as ManifestEntry[]])
  ) as Record<IdlePrefetchGroup, ManifestEntry[]>;

  return {
    name: 'idle-prefetch-manifest',
    apply: 'build',
    generateBundle(_options, bundle) {
      bundleGroupEntries = Object.fromEntries(
        IDLE_PREFETCH_GROUPS.map((group) => [
          group,
          collectIdlePrefetchGroupEntriesFromBundle(bundle, group),
        ])
      ) as Record<IdlePrefetchGroup, ManifestEntry[]>;
    },
    closeBundle: {
      sequential: true,
      order: 'post',
      async handler() {
        const outDir = path.resolve(__dirname, '../../dist/apps/web');
        const assetsDir = path.join(outDir, 'assets');
        const precacheManifestPath = path.join(
          outDir,
          'precache-manifest.json'
        );
        const groups = Object.fromEntries(
          IDLE_PREFETCH_GROUPS.map((group) => [
            group,
            [] as Array<{ url: string; revision: string }>,
          ])
        ) as Record<
          IdlePrefetchGroup,
          Array<{ url: string; revision: string }>
        >;
        const precachedUrls = new Set<string>();

        if (fs.existsSync(precacheManifestPath)) {
          try {
            const precacheManifest = JSON.parse(
              (await readFileWithFdRetry(
                precacheManifestPath,
                'utf8'
              )) as string
            ) as { files?: Array<{ url?: string }> };
            for (const entry of precacheManifest.files || []) {
              if (typeof entry.url === 'string' && entry.url.length > 0) {
                precachedUrls.add(entry.url);
              }
            }
          } catch (error) {
            console.warn(
              '[IdlePrefetch] Failed to read precache-manifest.json:',
              error
            );
          }
        }

        if (fs.existsSync(assetsDir)) {
          for (const group of IDLE_PREFETCH_GROUPS) {
            if (group === 'offline-static-assets') {
              continue;
            }

            const expandedEntries =
              bundleGroupEntries[group].length > 0
                ? bundleGroupEntries[group]
                : collectNamedGroupEntriesFromOutputDir(assetsDir, group);

            groups[group] = expandedEntries.filter((entry) => {
              const fullPath = path.join(outDir, entry.url.replace(/^\//, ''));
              return fs.existsSync(fullPath) && !precachedUrls.has(entry.url);
            });
          }
        }

        groups['runtime-static-assets'] = collectStaticEntries(
          outDir,
          (url, ext) =>
            !precachedUrls.has(url) &&
            ext !== '.html' &&
            POST_BOOT_PREFETCH_EXTENSIONS.has(ext) &&
            isRuntimeStaticAssetUrl(url)
        );

        const runtimeStaticUrls = new Set(
          groups['runtime-static-assets'].map((entry) => entry.url)
        );

        groups['offline-static-assets'] = collectStaticEntries(
          outDir,
          (url, ext) =>
            !precachedUrls.has(url) &&
            !runtimeStaticUrls.has(url) &&
            ext !== '.html' &&
            POST_BOOT_PREFETCH_EXTENSIONS.has(ext)
        );

        const manifestPath = path.join(outDir, 'idle-prefetch-manifest.json');
        fs.writeFileSync(
          manifestPath,
          JSON.stringify(
            {
              version: appVersion,
              timestamp: new Date().toISOString(),
              defaults: [...IDLE_PREFETCH_DEFAULTS],
              groups,
            },
            null,
            2
          )
        );
        console.log('[IdlePrefetch] Generated idle-prefetch-manifest.json');
      },
    },
  };
}

function deferEntryAssetsPlugin(): Plugin {
  return {
    name: 'defer-entry-assets',
    apply: 'build',
    closeBundle: {
      sequential: true,
      order: 'post',
      async handler() {
        const outDir = path.resolve(__dirname, '../../dist/apps/web');
        const indexHtmlPath = path.join(outDir, 'index.html');

        if (!fs.existsSync(indexHtmlPath)) {
          return;
        }

        const html = (await readFileWithFdRetry(
          indexHtmlPath,
          'utf8'
        )) as string;
        const deferredTags: string[] = [];
        const assetTagPattern =
          /^[ \t]*(<script\b[^>]*type="module"[^>]*src="\.\/assets\/[^"]+"[^>]*><\/script>|<link\b[^>]*rel="stylesheet"[^>]*href="\.\/assets\/[^"]+"[^>]*>)\s*$/gm;

        const strippedHtml = html.replace(assetTagPattern, (_match, tag) => {
          deferredTags.push(tag.trim());
          return '';
        });

        if (deferredTags.length === 0) {
          return;
        }

        const injection = `  ${deferredTags.join('\n  ')}\n`;
        const nextHtml = strippedHtml.replace('</body>', `${injection}</body>`);

        await writeFileWithFdRetry(indexHtmlPath, nextHtml);
        console.log(
          `[EntryAssets] Deferred ${deferredTags.length} entry asset tag(s) to body end`
        );
      },
    },
  };
}

// 检测是否在 watch 模式下运行（命令行包含 --watch）
const isWatchMode = process.argv.includes('--watch');
const isServeMode = process.argv.includes('serve');
const reactNodeEnv = isWatchMode || isServeMode ? 'development' : 'production';

export default defineConfig({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/apps/web',

  // 使用相对路径，静态资源全部走自建服务器，SW 只负责缓存
  base: process.env.VITE_BASE_URL || './',

  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(appVersion),
    'process.env.NODE_ENV': JSON.stringify(reactNodeEnv),
    __APP_VERSION__: JSON.stringify(appVersion),
    // Vue feature flags - @milkdown/crepe 内部使用了 Vue，需要定义这些编译时标志
    __VUE_OPTIONS_API__: JSON.stringify(false),
    __VUE_PROD_DEVTOOLS__: JSON.stringify(false),
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: JSON.stringify(false),
  },

  esbuild: {
    jsxDev: false,
  },

  server: {
    port: 7200,
    host: 'localhost',
    headers: {
      'Content-Security-Policy':
        "default-src 'self' https: data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com https://www.google-analytics.com https://us.i.posthog.com https://us-assets.i.posthog.com https://wiki.tu-zi.com; worker-src 'self' blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' http: https: ws: wss: data:; frame-ancestors 'self' localhost:* 127.0.0.1:* https://api.tu-zi.com;",
    },
    // dev 代理：让图片提交请求在本地开发环境按同源方式携带 X-Request-Id
    // 只允许固定 Tuzi 节点，保留原 Token、计费和权限域。
    proxy: {
      '/__opentu_tuzi_proxy__/api/': {
        target: 'https://api.tu-zi.com',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/__opentu_tuzi_proxy__\/api/, ''),
      },
      '/__opentu_tuzi_proxy__/apius/': {
        target: 'https://apius.tu-zi.com',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/__opentu_tuzi_proxy__\/apius/, ''),
      },
      '/__opentu_tuzi_proxy__/apicdn/': {
        target: 'https://apicdn.tu-zi.com',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/__opentu_tuzi_proxy__\/apicdn/, ''),
      },
      '/__opentu_tuzi_proxy__/sydney/': {
        target: 'https://api.sydney-ai.com',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/__opentu_tuzi_proxy__\/sydney/, ''),
      },
      '/__opentu_tuzi_proxy__/ourzhishi/': {
        target: 'https://api.ourzhishi.top',
        changeOrigin: true,
        secure: true,
        rewrite: (path) =>
          path.replace(/^\/__opentu_tuzi_proxy__\/ourzhishi/, ''),
      },
      '/__opentu_tuzi_proxy__/ourzhishi-sz/': {
        target: 'https://apisz.ourzhishi.top',
        changeOrigin: true,
        secure: true,
        rewrite: (path) =>
          path.replace(/^\/__opentu_tuzi_proxy__\/ourzhishi-sz/, ''),
      },
    },
  },

  preview: {
    port: 4300,
    host: 'localhost',
    headers: {
      'Content-Security-Policy':
        "upgrade-insecure-requests; default-src 'self' https: data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com https://www.google-analytics.com https://us.i.posthog.com https://us-assets.i.posthog.com https://wiki.tu-zi.com; worker-src 'self' blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' https: wss: data:; frame-ancestors 'self' localhost:* 127.0.0.1:* https://api.tu-zi.com;",
    },
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
    deferEntryAssetsPlugin(),
    precacheManifestPlugin(),
    idlePrefetchManifestPlugin(),
  ],

  resolve: {
    alias: [
      ...diagramEngineAliases,
      {
        find: /^tdesign-react$/,
        replacement: path.resolve(
          __dirname,
          '../../packages/drawnix/src/utils/tdesign.ts'
        ),
      },
    ],
    dedupe: ['react', 'react-dom'],
  },

  // Uncomment this if you are using workers.
  // worker: {
  //  plugins: [ nxViteTsPaths() ],
  // },

  build: {
    outDir: '../../dist/apps/web',
    // watch 模式下不清空输出目录，避免 index.html 丢失导致 serve 失败
    emptyOutDir: !isWatchMode,
    reportCompressedSize: true,
    // 首屏只注入壳层资源，懒加载分组改由运行时按需拉取/空闲预取。
    modulePreload: false,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
    rollupOptions: {
      output: {
        manualChunks(id, context) {
          return resolveManualChunk(id, context);
        },
      },
    },
  },
});
