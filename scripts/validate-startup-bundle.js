const fs = require('fs');
const path = require('path');

const DIST_DIR = path.resolve(__dirname, '../dist/apps/web');
const INDEX_HTML = path.join(DIST_DIR, 'index.html');
const IDLE_MANIFEST = path.join(DIST_DIR, 'idle-prefetch-manifest.json');
const DISALLOWED_PREFIXES = [
  'diagram-engines-',
  'tool-windows-',
  'external-skills-',
];
const MAX_STARTUP_ASSET_BYTES = 500 * 1024;
const STATIC_IMPORT_RE =
  /(?:\bimport\s*(?:[^"'`]*?\bfrom\s*)?|\bexport\s*[^"'`]*?\bfrom\s*)["']\.\/([^"']+)["']/g;
const DYNAMIC_IMPORT_RE = /\bimport\(["']\.\/([^"']+)["']\)/g;

function fail(message) {
  console.error(`[startup-validate] ${message}`);
  process.exit(1);
}

if (!fs.existsSync(INDEX_HTML)) {
  fail('dist/apps/web/index.html 不存在，请先构建 web 应用');
}

const html = fs.readFileSync(INDEX_HTML, 'utf8');
const scriptMatches = Array.from(
  html.matchAll(/<script[^>]+src="(?:\.\/|\/)([^"]+)"[^>]*><\/script>/g)
).map((match) => match[1]);
const styleMatches = Array.from(
  html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="(?:\.\/|\/)([^"]+)"[^>]*>/g)
).map((match) => match[1]);

const directAssets = [...scriptMatches, ...styleMatches].filter((asset) =>
  asset.startsWith('assets/')
);

if (directAssets.length === 0) {
  fail('入口 HTML 没有直接引用任何 assets 资源');
}

const directScriptAssets = scriptMatches.filter((asset) =>
  asset.startsWith('assets/')
);

// 运行时分组样式允许直接注入 HTML，避免首次展示时额外请求 CSS。
// 这里仅阻止分组 JS 重新回流到首屏入口链。
const invalidDirectAssets = directScriptAssets.filter((asset) =>
  DISALLOWED_PREFIXES.some((prefix) => path.basename(asset).startsWith(prefix))
);

if (invalidDirectAssets.length > 0) {
  fail(`重模块重新回流到入口 HTML：${invalidDirectAssets.join(', ')}`);
}

let idleManifest = { groups: {} };
if (fs.existsSync(IDLE_MANIFEST)) {
  idleManifest = JSON.parse(fs.readFileSync(IDLE_MANIFEST, 'utf8'));
}

function collectStaticImports(entryAsset, visited = new Set()) {
  if (visited.has(entryAsset)) {
    return visited;
  }
  visited.add(entryAsset);

  const fullPath = path.join(DIST_DIR, entryAsset);
  if (!fs.existsSync(fullPath) || !entryAsset.endsWith('.js')) {
    return visited;
  }

  const source = fs.readFileSync(fullPath, 'utf8');
  STATIC_IMPORT_RE.lastIndex = 0;
  let match;

  while ((match = STATIC_IMPORT_RE.exec(source))) {
    const imported = path.posix.normalize(
      path.posix.join(path.posix.dirname(entryAsset), match[1])
    );
    if (!visited.has(imported)) {
      collectStaticImports(imported, visited);
    }
  }

  return visited;
}

function collectDirectDynamicImports(entryAsset) {
  const dynamicImports = new Set();
  const fullPath = path.join(DIST_DIR, entryAsset);
  if (!fs.existsSync(fullPath) || !entryAsset.endsWith('.js')) {
    return dynamicImports;
  }

  const source = fs.readFileSync(fullPath, 'utf8');
  DYNAMIC_IMPORT_RE.lastIndex = 0;
  let match;

  while ((match = DYNAMIC_IMPORT_RE.exec(source))) {
    dynamicImports.add(
      path.posix.normalize(
        path.posix.join(path.posix.dirname(entryAsset), match[1])
      )
    );
  }

  return dynamicImports;
}

function collectStaticImportAssets(entryAsset) {
  const imports = new Set();
  const fullPath = path.join(DIST_DIR, entryAsset);
  if (!fs.existsSync(fullPath) || !entryAsset.endsWith('.js')) {
    return imports;
  }

  const source = fs.readFileSync(fullPath, 'utf8');
  STATIC_IMPORT_RE.lastIndex = 0;
  let match;

  while ((match = STATIC_IMPORT_RE.exec(source))) {
    imports.add(
      path.posix.normalize(
        path.posix.join(path.posix.dirname(entryAsset), match[1])
      )
    );
  }

  return imports;
}

function collectJsAssets() {
  const assetsDir = path.join(DIST_DIR, 'assets');
  if (!fs.existsSync(assetsDir)) {
    return [];
  }

  return fs
    .readdirSync(assetsDir)
    .filter((fileName) => fileName.endsWith('.js'))
    .map((fileName) => path.posix.join('assets', fileName));
}

function buildStaticChunkGraph() {
  const jsAssets = collectJsAssets();
  const jsAssetSet = new Set(jsAssets);
  const graph = new Map();

  for (const asset of jsAssets) {
    const imports = Array.from(collectStaticImportAssets(asset)).filter(
      (importedAsset) => jsAssetSet.has(importedAsset)
    );
    graph.set(asset, imports);
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

const entryScripts = scriptMatches.filter(
  (asset) => asset.startsWith('assets/') && asset.endsWith('.js')
);

const entryDependencyGraph = new Set();
entryScripts.forEach((asset) => {
  collectStaticImports(asset, entryDependencyGraph);
  for (const dynamicAsset of collectDirectDynamicImports(asset)) {
    collectStaticImports(dynamicAsset, entryDependencyGraph);
  }
});

const invalidStaticDeps = Array.from(entryDependencyGraph).filter(
  (asset) =>
    asset !== undefined &&
    DISALLOWED_PREFIXES.some((prefix) => path.basename(asset).startsWith(prefix))
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

const startupAssetGraph = new Set([
  ...directAssets,
  ...entryDependencyGraph,
]);
const startupBudgetReport = Array.from(startupAssetGraph)
  .filter((asset) => asset && (asset.endsWith('.js') || asset.endsWith('.css')))
  .map((asset) => {
    const fullPath = path.join(DIST_DIR, asset);
    const size = fs.existsSync(fullPath) ? fs.statSync(fullPath).size : 0;
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
        ({ asset, size, limit }) =>
          `- ${asset}: ${size} bytes > ${limit} bytes`
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
