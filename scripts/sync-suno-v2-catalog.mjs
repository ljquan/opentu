import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Read-only access to the supplied Tuzi checkout; write only OpenTu contract snapshots.
const tuziRoot = process.argv[2];
if (!tuziRoot) throw new Error('Usage: node scripts/sync-suno-v2-catalog.mjs /path/to/tu-zi-api');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = JSON.parse(fs.readFileSync(path.join(tuziRoot, 'pkg/sunoprotocol/catalog.json'), 'utf8'));
const results = JSON.parse(fs.readFileSync(path.join(tuziRoot, 'relay/channel/task/sunov2/testdata/upstream_results.json'), 'utf8'));
const fields = {};
const schemaKeys = ['type', 'enum', 'default', 'minimum', 'maximum', 'minItems', 'maxItems', 'minLength', 'maxLength', 'items'];
const actions = source.actions.map((action) => {
  if (action.canonical_model !== `suno/${action.action}` || action.upstream_path !== `/suno/v2/${action.action}` || !results[action.action]) {
    throw new Error(`Incomplete native action contract: ${action.action}`);
  }
  const actionFields = Object.entries(action.request_schema.properties).map(([name, schema]) => {
    const field = { type: schema.type, label: schema['x-title-zh'] || name, description: schema['x-description-zh'] };
    for (const key of schemaKeys) if (schema[key] !== undefined) field[key] = schema[key];
    if (schema['x-enum-labels-zh']) field.enumLabels = schema['x-enum-labels-zh'];
    const key = !fields[name] || JSON.stringify(fields[name]) === JSON.stringify(field) ? name : `${action.action}:${name}`;
    fields[key] = field;
    return key;
  });
  return { action: action.action, model: action.canonical_model, label: action.endpoint_label,
    description: action.description, resultKind: action.result_kind, required: action.request_schema.required || [], fields: actionFields };
});
const fixtures = { verifiedAt: source.verified_at, actions: source.actions.map((action) => ({
  action: action.action, model: action.canonical_model, path: action.upstream_path,
  request: action.request_example, response: results[action.action],
})) };
const catalogPath = path.join(root, 'packages/drawnix/src/services/suno-v2-catalog.json');
const fixturesPath = path.join(root, 'packages/drawnix/src/services/__tests__/fixtures/suno-v2-contract.json');
fs.mkdirSync(path.dirname(fixturesPath), { recursive: true });
fs.writeFileSync(catalogPath, JSON.stringify({ verifiedAt: source.verified_at, actions, fields }, null, 2) + '\n');
fs.writeFileSync(fixturesPath, JSON.stringify(fixtures, null, 2) + '\n');
console.log(`Synced ${actions.length} native Suno actions, parameters and request/response fixtures.`);
