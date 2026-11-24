const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { randomBytes } = require('node:crypto');

function validate(change = () => {}, sizes = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opentu-budget-'));
  const manifest = {
    'index.html': { file: 'entry.js', isEntry: true, dynamicImports: ['main'] },
    main: { file: 'main.js', dynamicImports: ['bootstrap'] },
    bootstrap: { file: 'bootstrap.js', dynamicImports: ['_canvas-hash.js'] },
    '_canvas-hash.js': {
      file: 'canvas.js',
      name: 'canvas',
      imports: ['shared'],
      css: ['canvas.css'],
      dynamicImports: ['optional'],
    },
    shared: { file: 'shared.js' },
    optional: { file: 'optional.js' },
  };
  change(manifest);
  try {
    fs.mkdirSync(path.join(dir, '.vite'));
    fs.writeFileSync(
      path.join(dir, '.vite/manifest.json'),
      JSON.stringify(manifest)
    );
    for (const chunk of Object.values(manifest)) {
      for (const file of [chunk.file, ...(chunk.css || [])]) {
        fs.writeFileSync(path.join(dir, file), sizes[file] || '/* asset */');
      }
    }
    return spawnSync(
      process.execPath,
      [path.join(__dirname, 'validate-startup-bundle.js'), dir],
      { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 }
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('counts shared canvas dependencies once and excludes optional chunks', () => {
  const result = validate(
    (m) => {
      m.bootstrap.imports = ['shared'];
      m['_canvas-hash.js'].imports.push('bootstrap');
    },
    { 'optional.js': Buffer.alloc(800 * 1024) }
  );
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(
    report.canvasBudget.assets.filter((a) => a.asset === 'shared.js').length,
    1
  );
  assert(!report.canvasBudget.assets.some((a) => a.asset === 'optional.js'));
  assert(report.canvasBudget.assets.some((a) => a.asset === 'canvas.css'));
});

test('fails instead of silently skipping an unidentified canvas', () => {
  const result = validate((m) => {
    m['_canvas-hash.js'].name = 'renamed';
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /唯一的 canvas/);
});

test('checks aggregate size even when every canvas asset meets its own budget', () => {
  const sizes = {};
  const result = validate((m) => {
    for (let i = 0; i < 7; i++) {
      const key = `extra${i}`;
      m[key] = { file: `${key}.js` };
      m['_canvas-hash.js'].imports.push(key);
      sizes[`${key}.js`] = Buffer.alloc(460 * 1024);
    }
  }, sizes);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /依赖总量超出预算/);
});

test('also checks the gzip total independently of raw size', () => {
  const result = validate(
    (m) => {
      m['_canvas-hash.js'].imports.push('other');
      m.other = { file: 'other.js' };
    },
    {
      'canvas.js': randomBytes(480 * 1024),
      'other.js': randomBytes(480 * 1024),
    }
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /依赖总量超出预算/);
});

test('rejects an oversized canvas asset', () => {
  const result = validate(undefined, { 'canvas.js': Buffer.alloc(701 * 1024) });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /超过 700KB/);
});

test('checks references to lazy dependencies for first use', () => {
  const result = validate((m) => {
    m['_canvas-hash.js'].dynamicImports.push('missing');
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /构建清单缺少依赖/);
});

test('continues to reject static chunk cycles', () => {
  const result = validate((m) => {
    m.shared.imports = ['_canvas-hash.js'];
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /循环依赖/);
});
