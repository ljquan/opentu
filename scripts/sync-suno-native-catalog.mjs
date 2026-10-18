import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

// Download the .md OpenAPI documents from docs.sunoapi.org/llms.txt first.
// This script only reads the documentation and Tuzi checkout supplied by the caller.
const [docsRoot, tuziRoot] = process.argv.slice(2);
if (!docsRoot || !tuziRoot) throw new Error('Usage: node scripts/sync-suno-native-catalog.mjs <markdown-dir> <tuzi-checkout>');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const routes = fs.readFileSync(path.join(tuziRoot, 'router/relay-router.go'), 'utf8');
const definitions = [
  ['generate', '音乐生成', 'generate-music', 'get-music-generation-details', 'audio'],
  ['sounds', '声音生成', 'generate-sounds', 'get-music-generation-details', 'audio'],
  ['extend', '续写', 'extend-music', 'get-music-generation-details', 'audio'],
  ['upload-cover', '上传翻唱', 'upload-and-cover-audio', 'get-music-generation-details', 'audio'],
  ['upload-extend', '上传续写', 'upload-and-extend-audio', 'get-music-generation-details', 'audio'],
  ['add-instrumental', '添加伴奏', 'add-instrumental', 'get-music-generation-details', 'audio'],
  ['add-vocals', '添加人声', 'add-vocals', 'get-music-generation-details', 'audio'],
  ['mashup', '双曲混合', 'generate-mashup', 'get-music-generation-details', 'audio'],
  ['replace-section', '局部替换', 'replace-section', 'get-music-generation-details', 'audio'],
  ['lyrics', '歌词生成', 'generate-lyrics', 'get-lyrics-generation-details', 'lyrics'],
  ['wav', 'WAV 导出', 'convert-to-wav-format', 'get-wav-conversion-details', 'audio'],
  ['stems', '人声与乐器分轨', 'separate-vocals-from-music', 'get-vocal-separation-details', 'audio'],
  ['midi', 'MIDI 导出', 'generate-midi', 'get-midi-details', 'midi'],
  ['mp4', 'MP4 音乐视频', 'create-music-video', 'get-music-video-details', 'video'],
  ['cover-image', '封面生成', 'cover-suno', 'get-cover-suno-details', 'image'],
  ['style', '风格扩写', 'boost-music-style', 'get-music-generation-details', 'text'],
  ['persona', '创建 Persona', 'generate-persona', null, 'persona'],
  ['timestamped-lyrics', '歌词时间轴', 'get-timestamped-lyrics', null, 'timeline'],
  ['voice-validate', '生成音色验证文案', 'suno-voice-validate', 'suno-voice-validate-info', 'text'],
  ['voice-generate', '提交验证录音创建音色', 'suno-voice-generate', 'suno-voice-record-info', 'voice'],
  ['voice-regenerate', '重新生成验证文案', 'suno-voice-regenerate', 'suno-voice-validate-info', 'text'],
  ['voice-check', '检查音色可用性', 'suno-voice-check-voice', null, 'availability'],
  ['upload-url', 'URL 上传', 'upload-file-url', null, 'upload'],
  ['upload-base64', 'Base64 上传', 'upload-file-base-64', null, 'upload'],
  ['upload-stream', '文件上传', 'upload-file-stream', null, 'upload'],
  ['credits', '查询上游剩余额度', 'get-remaining-credits', null, 'credits'],
];
function read(name) {
  const doc = fs.readFileSync(path.join(docsRoot, `${name}.md`), 'utf8');
  const match = doc.match(/````yaml[^\n]*\n([\s\S]*?)````/);
  if (!match) throw new Error(`Missing OpenAPI: ${name}`);
  const api = yaml.load(match[1]);
  const deref = (value) => {
    if (Array.isArray(value)) return value.map(deref);
    if (!value || typeof value !== 'object') return value;
    if (value.$ref) return deref(value.$ref.slice(2).split('/').reduce((v, k) => v[k], api));
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, deref(child)]));
  };
  const [route, methods] = Object.entries(api.paths)[0];
  const [method, operation] = Object.entries(methods)[0];
  const content = operation.requestBody?.content;
  const mime = content ? Object.keys(content)[0] : undefined;
  const response = deref(operation.responses['200']);
  const schema = deref(content?.[mime]?.schema) || { type: 'object', properties: {}, required: [] };
  for (const branch of schema.oneOf || []) schema.properties = { ...schema.properties, ...branch.properties };
  return { path: `/suno${route}`, method: method.toUpperCase(), mime,
    schema,
    response: response.content['application/json'] };
}
const actions = definitions.map(([action, label, name, poll, resultKind]) => {
  const doc = read(name);
  const routerPath = doc.path.slice('/suno/api'.length);
  if (!routes.includes(`relaySunoNativeRouter.${doc.method}("${routerPath}"`)) throw new Error(`Tuzi route missing: ${doc.path}`);
  const query = poll ? read(poll) : undefined;
  if (query && !routes.includes(`relaySunoNativeRouter.GET("${query.path.slice('/suno/api'.length)}"`)) throw new Error(`Tuzi query route missing: ${query.path}`);
  return { action, label, resultKind, ...doc, pollPath: query?.path, pollResponse: query?.response,
    docsUrl: `https://docs.sunoapi.org/${name.startsWith('upload-file') ? 'file-upload-api' : 'suno-api'}/${name}` };
});
// Keep response contracts in test fixtures, not in the runtime bundle.
const catalog = { verifiedAt: '2026-10-13', actions: actions.map(({ response, pollResponse, ...action }) => action) };
fs.writeFileSync(path.join(root, 'packages/drawnix/src/services/suno-native-catalog.json'), JSON.stringify(catalog, null, 2) + '\n');
fs.writeFileSync(path.join(root, 'packages/drawnix/src/services/__tests__/fixtures/suno-native-contract.json'), JSON.stringify({ actions }, null, 2) + '\n');
console.log(`Synced ${actions.length} Tuzi native operations and official OpenAPI contracts.`);
