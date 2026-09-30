const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const postcss = require('postcss');
const scopeWorkflowCss = require('./workflow-css-scope.cjs');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist/apps/web');
const html = fs.readFileSync(path.join(output, 'index.html'), 'utf8');
const baseScript = html.match(/<script id="workflow-resource-base">([\s\S]*?)<\/script>/)?.[1];
assert.ok(baseScript, 'Missing workflow resource base handling');
const assetUrls = [...html.matchAll(/(?:src|href)="(\.\/assets\/[^"?#]+)"/g)].map(match => match[1]);
assert.ok(assetUrls.length, 'Missing entry assets');

for (const route of ['/', '/workflow', '/workflow/', '/workflow/canvas/existing']) {
  // Execute only the small base-URL initializer, without page scripts or network access.
  const dom = new JSDOM('', { url: `https://local.test${route}`, runScripts: 'outside-only' });
  dom.window.eval(baseScript);
  for (const relative of assetUrls) {
    const url = new URL(relative, dom.window.document.baseURI);
    assert.ok(url.pathname.startsWith('/assets/'), `${route} resolves to ${url.pathname}`);
    assert.ok(fs.existsSync(path.join(output, url.pathname)), `Missing ${url.pathname}`);
  }
  dom.window.close();
}

const pluginUrls = JSON.parse(fs.readFileSync(path.join(output, 'workflow-assets/plugins/index.json'), 'utf8'));
assert.ok(Array.isArray(pluginUrls));
for (const url of pluginUrls) {
  assert.ok(url.startsWith('/workflow-assets/plugins/'));
  assert.ok(fs.existsSync(path.join(output, url)), `Missing ${url}`);
}
assert.ok(fs.existsSync(path.join(output, 'workflow-assets/icons/openai.svg')));
assert.ok(!fs.existsSync(path.join(output, 'workflow-app/index.html')), 'Standalone workflow output remains');

const assets = path.join(output, 'assets');
const workflowCss = fs.readdirSync(assets).find(file => file.endsWith('.css') && fs.readFileSync(path.join(assets, file), 'utf8').includes('.workflow-app-root .ai-title-aurora'));
assert.ok(workflowCss, 'Missing lazy workflow stylesheet');
const css = fs.readFileSync(path.join(assets, workflowCss), 'utf8');
let rules = 0;
postcss.parse(css).walkRules(rule => {
  for (let parent = rule.parent; parent; parent = parent.parent) {
    if (parent.type === 'rule' || (parent.type === 'atrule' && /keyframes$/.test(parent.name))) return;
  }
  assert.ok(rule.selector.includes('.workflow-app-root'), `Unscoped workflow selector: ${rule.selector}`);
  rules++;
});
assert.ok(rules > 0);

const scripts = fs.readdirSync(assets).filter(file => file.endsWith('.js'));
const bootstrap = scripts.find(file => file.startsWith('bootstrap-'));
assert.ok(bootstrap, 'Missing app bootstrap');
const visited = new Set();
function inspectStaticImports(file) {
  if (visited.has(file)) return;
  visited.add(file);
  const code = fs.readFileSync(path.join(assets, file), 'utf8');
  assert.ok(!code.includes('opentu-workflow-root'), `Workflow loaded eagerly by ${file}`);
  for (const match of code.matchAll(/(?:\bimport\s*(?:[^"'`]*?\bfrom\s*)?|\bexport\s*[^"'`]*?\bfrom\s*)["']\.\/([^"']+)["']/g)) {
    if (scripts.includes(match[1])) inspectStaticImports(match[1]);
  }
}
inspectStaticImports(bootstrap);

async function verifyCssScope() {
  const from = path.join(root, 'packages/drawnix/src/workflow-mode/web/src/styles/globals.css');
  const sample = 'html, body { color: black } .dark .node { color: white } @keyframes spin { to { opacity: 1 } }';
  const scoped = await postcss([scopeWorkflowCss()]).process(sample, { from });
  assert.ok(scoped.css.includes('.workflow-app-root.dark .node'));
  assert.ok(scoped.css.includes('to { opacity: 1 }'));
  const untouched = await postcss([scopeWorkflowCss()]).process(sample, { from: path.join(root, 'apps/web/src/styles.css') });
  assert.equal(untouched.css, sample);
  console.log(`Workflow runtime validation passed: 4 entry routes, ${rules} scoped CSS rules, ${pluginUrls.length} local plugins, icons and unified output.`);
}
verifyCssScope().catch(error => { console.error(error); process.exitCode = 1; });
