const fs = require('fs');
const path = require('path');

const DIST_DIR = path.resolve(__dirname, '../dist/apps/web');
const BUNDLE_MANIFEST = path.join(DIST_DIR, '.vite/manifest.json');
const IDLE_MANIFEST = path.join(DIST_DIR, 'idle-prefetch-manifest.json');
const DISALLOWED_PREFIXES = [
  'diagram-engines-',
  'tool-windows-',
  'external-skills-',
];
const MAX_STARTUP_ASSET_BYTES = 500 * 1024;

function fail(message) {
  console.error(`[startup-validate] ${message}`);
  process.exit(1);
}

if (!fs.existsSync(BUNDLE_MANIFEST)) {
  fail('缺少 Vite 构建清单，请先构建 web 应用');
}

const manifest = JSON.parse(fs.readFileSync(BUNDLE_MANIFEST, 'utf8'));
const entry = manifest['index.html'];
if (!entry?.isEntry) {
  fail('Vite 构建清单缺少 Web 入口');
}
const directAssets = [entry.file, ...(entry.css || [])];
const idleManifest = fs.existsSync(IDLE_MANIFEST)
  ? JSON.parse(fs.readFileSync(IDLE_MANIFEST, 'utf8'))
  : { groups: {} };

function collectStaticAssets(key, visited = new Set(), assets = new Set()) {
  if (visited.has(key)) return assets;
  visited.add(key);
  const chunk = manifest[key];
  if (!chunk) fail(`构建清单缺少依赖：${key}`);
  assets.add(chunk.file);
  for (const css of chunk.css || []) assets.add(css);
  for (const importedKey of chunk.imports || []) {
    collectStaticAssets(importedKey, visited, assets);
  }
  return assets;
}

function getBootstrapImport(key) {
  const imports = manifest[key]?.dynamicImports || [];
  if (imports.length !== 1) {
    fail(`启动入口应包含一个立即执行的动态导入：${key}`);
  }
  return imports[0];
}

function buildStaticChunkGraph() {
  const graph = new Map();
  for (const chunk of Object.values(manifest)) {
    if (!chunk.file.endsWith('.js')) continue;
    graph.set(
      chunk.file,
      (chunk.imports || []).map((key) => {
        if (!manifest[key]) fail(`构建清单缺少依赖：${key}`);
        return manifest[key].file;
      })
    );
  }
  return graph;
}

function findStronglyConnectedComponents(graph) {
  let index = 0;
  const stack = [];
  const onStack = new Set();
  const indexes = new Map();
  const lowlinks = new Map();
  const components = [];

  function visit(node) {
    indexes.set(node, index);
    lowlinks.set(node, index);
    index += 1;
    stack.push(node);
    onStack.add(node);

    for (const next of graph.get(node) || []) {
      if (!graph.has(next)) {
        continue;
      }

      if (!indexes.has(next)) {
        visit(next);
        lowlinks.set(node, Math.min(lowlinks.get(node), lowlinks.get(next)));
      } else if (onStack.has(next)) {
        lowlinks.set(node, Math.min(lowlinks.get(node), indexes.get(next)));
      }
    }

    if (lowlinks.get(node) === indexes.get(node)) {
      const component = [];
      let current;

      do {
        current = stack.pop();
        onStack.delete(current);
        component.push(current);
      } while (current !== node);

      if (component.length > 1) {
        components.push(component.sort());
      }
    }
  }

  for (const node of graph.keys()) {
    if (!indexes.has(node)) {
      visit(node);
    }
  }

  return components.sort((a, b) => b.length - a.length);
}

// index.html runs main.tsx, which immediately loads bootstrap.tsx. Subsequent
// dynamic imports can depend on user state or open optional features.
const mainKey = getBootstrapImport('index.html');
const bootstrapKey = getBootstrapImport(mainKey);
const entryDependencyGraph = new Set([
  ...collectStaticAssets('index.html'),
  ...collectStaticAssets(mainKey),
  ...collectStaticAssets(bootstrapKey),
]);

const invalidStaticDeps = Array.from(entryDependencyGraph).filter(
  (asset) =>
    asset.endsWith('.js') &&
    DISALLOWED_PREFIXES.some((prefix) =>
      path.basename(asset).startsWith(prefix)
    )
);

if (invalidStaticDeps.length > 0) {
  fail(`重模块重新回流到入口依赖链：${invalidStaticDeps.join(', ')}`);
}

const chunkCycles = findStronglyConnectedComponents(buildStaticChunkGraph());
if (chunkCycles.length > 0) {
  const formattedCycles = chunkCycles
    .map((component, index) => `#${index + 1}: ${component.join(' -> ')}`)
    .join('\n');
  fail(`构建产物存在静态 chunk 循环依赖：\n${formattedCycles}`);
}

const startupAssetGraph = new Set([...directAssets, ...entryDependencyGraph]);
const startupBudgetReport = Array.from(startupAssetGraph)
  .filter((asset) => asset && (asset.endsWith('.js') || asset.endsWith('.css')))
  .map((asset) => {
    const fullPath = path.join(DIST_DIR, asset);
    if (!fs.existsSync(fullPath)) fail(`首屏资源不存在：${asset}`);
    const size = fs.statSync(fullPath).size;
    return {
      asset,
      size,
      limit: MAX_STARTUP_ASSET_BYTES,
      ok: size <= MAX_STARTUP_ASSET_BYTES,
    };
  })
  .sort((a, b) => b.size - a.size);

const oversizedStartupAssets = startupBudgetReport.filter((item) => !item.ok);
if (oversizedStartupAssets.length > 0) {
  fail(
    `首屏依赖链存在超过 500KB 的资源：\n${oversizedStartupAssets
      .map(
        ({ asset, size, limit }) => `- ${asset}: ${size} bytes > ${limit} bytes`
      )
      .join('\n')}`
  );
}

const sizeReport = directAssets.map((asset) => {
  const fullPath = path.join(DIST_DIR, asset);
  const size = fs.existsSync(fullPath) ? fs.statSync(fullPath).size : 0;
  return {
    asset,
    size,
  };
});

console.log(
  JSON.stringify(
    {
      directAssets: sizeReport,
      entryDependencyGraph: Array.from(entryDependencyGraph).sort(),
      startupBudget: startupBudgetReport,
      chunkCycles: [],
      idlePrefetchGroups: Object.keys(idleManifest.groups || {}),
    },
    null,
    2
  )
);
