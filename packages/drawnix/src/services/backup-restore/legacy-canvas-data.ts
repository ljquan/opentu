import JSZip from 'jszip';
import { generateUUID } from '../../utils/runtime-helpers';
import type { PlaitElement, Point } from '@plait/core';

export interface LegacyRecord {
  database: string;
  store: string;
  key: string;
  value?: unknown;
  file?: string;
  mimeType?: string;
}
export interface LegacyCanvasArchive {
  app: 'opentu-legacy-canvas';
  version: 1;
  records: LegacyRecord[];
  warnings: string[];
}
export interface LegacyCanvasSnapshot {
  manifest: LegacyCanvasArchive;
  files: Map<string, Blob>;
}
const credentialField =
  /api[-_]?key|authorization|password|secret|credential|access[-_]?token|refresh[-_]?token|token|cookie|headers/i;
const executableField = /^(source|script|code)$/i;
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function parsed(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/** Redact credentials structurally, including JSON strings in old localStorage records. */
export function sanitizeLegacyData(
  value: unknown,
  knownSecrets: readonly string[] = []
): unknown {
  if (typeof value === 'string') {
    const decoded = parsed(value);
    if (decoded !== value) return sanitizeLegacyData(decoded, knownSecrets);
    let cleaned = value;
    for (const secret of knownSecrets)
      if (secret) cleaned = cleaned.split(secret).join('[已移除凭据]');
    cleaned = cleaned.replace(
      /\b(?:sk-[A-Za-z0-9_-]{12,}|Bearer\s+[^\s"'<>]+)/gi,
      '[已移除凭据]'
    );
    if (/^https?:\/\//i.test(cleaned)) {
      try {
        const url = new URL(cleaned);
        url.username = '';
        url.password = '';
        for (const key of Array.from(url.searchParams.keys()))
          if (credentialField.test(key) || /^(key|token)$/i.test(key))
            url.searchParams.delete(key);
        return url.href;
      } catch {
        return cleaned;
      }
    }
    return cleaned;
  }
  if (Array.isArray(value))
    return value.map((item) => sanitizeLegacyData(item, knownSecrets));
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([key]) => !credentialField.test(key) && !executableField.test(key)
        )
        .map(([key, item]) => [key, sanitizeLegacyData(item, knownSecrets)])
    );
  return value;
}
function collectSecrets(value: unknown, secrets: Set<string>): void {
  const decoded = parsed(value);
  if (Array.isArray(decoded)) {
    decoded.forEach((item) => collectSecrets(item, secrets));
    return;
  }
  for (const [key, item] of Object.entries(record(decoded))) {
    if (credentialField.test(key) && typeof item === 'string' && item)
      secrets.add(item);
    else collectSecrets(item, secrets);
  }
}

/** Opening a missing database aborts its creation; existing data is read with readonly transactions. */
async function readLegacyDatabase(
  name: string
): Promise<Array<{ store: string; key: string; value: unknown }>> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name);
    let missing = false;
    request.onupgradeneeded = () => {
      missing = true;
      request.transaction?.abort();
    };
    request.onerror = () =>
      missing ? resolve([]) : reject(new Error(`无法读取旧数据库 ${name}`));
    request.onblocked = () =>
      reject(new Error(`旧数据库 ${name} 被占用，请关闭旧版本页面后重试`));
    request.onsuccess = () => {
      const db = request.result;
      const stores = Array.from(db.objectStoreNames);
      if (!stores.length) {
        db.close();
        resolve([]);
        return;
      }
      const rows: Array<{ store: string; key: string; value: unknown }> = [];
      const tx = db.transaction(stores, 'readonly');
      for (const store of stores) {
        const cursor = tx.objectStore(store).openCursor();
        cursor.onsuccess = () => {
          const item = cursor.result;
          if (!item) return;
          rows.push({ store, key: String(item.primaryKey), value: item.value });
          item.continue();
        };
      }
      tx.oncomplete = () => {
        db.close();
        resolve(rows);
      };
      tx.onabort = tx.onerror = () => {
        db.close();
        reject(new Error(`旧数据库 ${name} 读取失败`));
      };
    };
  });
}

export async function readLegacyCanvasData(): Promise<LegacyCanvasSnapshot> {
  const raw: LegacyRecord[] = [];
  const files = new Map<string, Blob>();
  const manifest: LegacyCanvasArchive = {
    app: 'opentu-legacy-canvas',
    version: 1,
    records: [],
    warnings: [
      '旧配置节点、插件和本地 Agent 不再执行；程序源码及凭据不包含在普通备份中。原数据库保持不变。',
      '导入不会重发生成请求；未完成任务及聊天仅作为资料保留，共享任务的查询由现有任务系统负责。',
    ],
  };
  for (const database of ['infinite-canvas', 'infinite-canvas-plugins']) {
    for (const row of await readLegacyDatabase(database))
      raw.push({ database, ...row });
  }
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (
      key?.startsWith('infinite-canvas:') ||
      key?.startsWith('canvas-image-quick-tools')
    ) {
      raw.push({
        database: 'localStorage',
        store: 'localStorage',
        key,
        value: localStorage.getItem(key),
      });
    }
  }
  const secrets = new Set<string>();
  raw.forEach((row) => collectSecrets(row.value, secrets));
  for (const row of raw) {
    if (credentialField.test(row.key)) {
      manifest.records.push({
        database: row.database,
        store: row.store,
        key: row.key,
        value: '[已移除凭据]',
      });
      continue;
    }
    if (
      row.value instanceof Blob &&
      !['image_files', 'image_previews', 'media_files'].includes(row.store)
    ) {
      manifest.warnings.push(
        `非媒体二进制记录 ${row.store} 未纳入普通备份，源库仍保留。`
      );
      continue;
    }
    if (row.value instanceof Blob) {
      const file = `media/${files.size}`;
      files.set(file, row.value);
      manifest.records.push({
        database: row.database,
        store: row.store,
        key: row.key,
        file,
        mimeType: row.value.type,
      });
    } else
      manifest.records.push({
        ...row,
        value: sanitizeLegacyData(row.value, [...secrets]),
      });
  }
  return { manifest, files };
}
export async function exportLegacyCanvasData(
  snapshot: LegacyCanvasSnapshot
): Promise<Blob> {
  validateLegacyManifest(snapshot.manifest);
  const secrets = new Set<string>();
  snapshot.manifest.records.forEach((row) =>
    collectSecrets(row.value, secrets)
  );
  const safeManifest = sanitizeLegacyData(
    {
      ...snapshot.manifest,
      records: snapshot.manifest.records.map((row) =>
        credentialField.test(row.key) ? { ...row, value: '[已移除凭据]' } : row
      ),
    },
    [...secrets]
  );
  const zip = new JSZip();
  zip.file('legacy-canvas.json', JSON.stringify(safeManifest, null, 2));
  for (const [path, blob] of snapshot.files) zip.file(path, blob);
  return zip.generateAsync({ type: 'blob' });
}
export function validateLegacyManifest(
  value: unknown
): asserts value is LegacyCanvasArchive {
  const data = record(value);
  if (
    data.app !== 'opentu-legacy-canvas' ||
    data.version !== 1 ||
    !Array.isArray(data.records) ||
    !Array.isArray(data.warnings)
  )
    throw new Error('不支持的旧数据备份格式或版本');
  if (!data.warnings.every((item) => typeof item === 'string'))
    throw new Error('备份报告格式无效');
  const seen = new Set<string>();
  for (const row of data.records) {
    const item = record(row);
    if (
      typeof item.database !== 'string' ||
      typeof item.store !== 'string' ||
      typeof item.key !== 'string' ||
      (item.file !== undefined &&
        (typeof item.file !== 'string' || !/^media\/\d+$/.test(item.file)))
    )
      throw new Error('旧数据记录格式无效');
    const id = JSON.stringify([item.database, item.store, item.key]);
    if (seen.has(id)) throw new Error('备份包含重复记录');
    seen.add(id);
  }
}
export async function loadLegacyCanvasArchive(
  blob: Blob
): Promise<LegacyCanvasSnapshot> {
  const zip = await JSZip.loadAsync(blob);
  const entry = zip.file('legacy-canvas.json');
  if (!entry) throw new Error('缺少旧数据清单');
  const manifest: unknown = JSON.parse(await entry.async('string'));
  validateLegacyManifest(manifest);
  const files = new Map<string, Blob>();
  for (const row of manifest.records)
    if (row.file) {
      const file = zip.file(row.file);
      if (!file) throw new Error(`备份媒体缺失：${row.file}`);
      files.set(
        row.file,
        new Blob([await file.async('arraybuffer')], {
          type: row.mimeType || 'application/octet-stream',
        })
      );
    }
  return { manifest, files };
}
export function getLegacyProjects(
  snapshot: LegacyCanvasSnapshot
): Record<string, unknown>[] {
  const row =
    snapshot.manifest.records.find(
      (item) =>
        item.store === 'app_state' &&
        item.key === 'infinite-canvas:canvas_store'
    ) ||
    snapshot.manifest.records.find(
      (item) => item.key === 'infinite-canvas:canvas_store'
    );
  if (!row) return [];
  const value = record(parsed(row.value));
  if (value.version !== 0 || !Array.isArray(record(value.state).projects))
    throw new Error('旧画布版本或结构无法安全转换，原数据已保留');
  const projects = record(value.state).projects as unknown[];
  if (
    projects.some(
      (project) =>
        typeof record(project).id !== 'string' ||
        !Array.isArray(record(project).nodes)
    )
  )
    throw new Error('旧画布项目结构无效');
  return projects.map(record);
}

/** No network access: only archived blobs and embedded data are eligible for conversion. */
export function getLegacyMedia(
  snapshot: LegacyCanvasSnapshot,
  metadata: Record<string, unknown>
): Blob | string | null {
  if (typeof metadata.storageKey === 'string') {
    const media = snapshot.manifest.records.find(
      (row) =>
        row.database === 'infinite-canvas' &&
        (row.store === 'image_files' || row.store === 'media_files') &&
        row.key === metadata.storageKey
    );
    if (media?.file && snapshot.files.has(media.file))
      return snapshot.files.get(media.file) || null;
  }
  return typeof metadata.content === 'string' &&
    /^data:(image|video|audio)\//.test(metadata.content)
    ? metadata.content
    : null;
}
export function legacyNodeElement(
  node: Record<string, unknown>,
  url?: string
): PlaitElement | null {
  const metadata = record(node.metadata);
  const position = record(node.position);
  const x = Number(position.x);
  const y = Number(position.y);
  const width = Number(node.width);
  const height = Number(node.height);
  if (
    ![x, y, width, height].every(Number.isFinite) ||
    width <= 0 ||
    height <= 0
  )
    throw new Error('节点位置或尺寸无效');
  const base = {
    id: generateUUID(),
    points: [
      [x, y],
      [x + width, y + height],
    ] as [Point, Point],
    legacyCanvasNodeId: node.id,
    legacyCanvasMetadata: sanitizeLegacyData(metadata),
    prompt: typeof metadata.prompt === 'string' ? metadata.prompt : undefined,
  };
  if (node.type === 'text')
    return {
      ...base,
      type: 'card',
      title: typeof node.title === 'string' ? node.title : '旧文本',
      body:
        typeof metadata.content === 'string'
          ? metadata.content
          : typeof metadata.prompt === 'string'
          ? metadata.prompt
          : '',
      fillColor: '#fff9c4',
    };
  if (!url) return null;
  if (node.type === 'image') return { ...base, type: 'image', url };
  if (node.type === 'video')
    return { ...base, type: 'video', url, width, height, angle: 0 };
  if (node.type === 'audio')
    return {
      ...base,
      type: 'audio',
      audioUrl: url,
      title: typeof node.title === 'string' ? node.title : '旧音频',
      createdAt: Date.now(),
    };
  return null;
}

let importRunning = false;
export async function importLegacyCanvasData(
  snapshot: LegacyCanvasSnapshot
): Promise<string[]> {
  if (importRunning) throw new Error('已有旧数据导入正在进行');
  validateLegacyManifest(snapshot.manifest);
  const projects = getLegacyProjects(snapshot);
  return runLegacyImport(snapshot, projects);
}

async function runLegacyImport(
  snapshot: LegacyCanvasSnapshot,
  projects: Record<string, unknown>[]
): Promise<string[]> {
  if (importRunning) throw new Error('已有旧数据导入正在进行');
  importRunning = true;
  const report: string[] = [...snapshot.manifest.warnings];
  try {
    const { workspaceService } = await import('../workspace-service');
    const { unifiedCacheService } = await import('../unified-cache-service');
    const { assetStorageService } = await import('../asset-storage-service');
    const { AssetType, AssetSource } = await import('../../types/asset.types');
    const { createPromptHistoryRecord } = await import(
      '../prompt-history-service'
    );
    const { createBoard } = await import('@plait/core');
    const { createCanvasAssociationLines } = await import(
      '../../plugins/canvas-association'
    );
    const batchId = generateUUID();
    const storeMedia = async (media: Blob | string, kind: string) => {
      const blob =
        typeof media === 'string' ? await (await fetch(media)).blob() : media;
      const mime = blob.type || `${kind}/octet-stream`;
      if (
        !['image', 'video', 'audio'].includes(kind) ||
        !mime.startsWith(`${kind}/`)
      )
        throw new Error('媒体类型与节点不一致');
      const url = `/__aitu_cache__/${kind}/legacy-${generateUUID()}`;
      await unifiedCacheService.cacheMediaFromBlob(
        url,
        blob,
        kind as 'image' | 'video' | 'audio'
      );
      const cached = await unifiedCacheService.getCachedBlob(url);
      if (!cached || cached.size !== blob.size)
        throw new Error('媒体未能完整保存');
      return { url, blob, mime };
    };
    await workspaceService.initialize();
    for (const [projectIndex, project] of projects.entries()) {
      const elements: PlaitElement[] = [];
      const ids = new Map<string, string>();
      let failed = false;
      for (const raw of project.nodes as unknown[]) {
        const node = record(raw);
        const metadata = record(node.metadata);
        try {
          if (
            node.type !== 'text' &&
            !['image', 'video', 'audio'].includes(String(node.type))
          ) {
            report.push(
              `项目 ${project.id} 节点 ${node.id}：配置、分组或插件节点仅保留在备份中。`
            );
            continue;
          }
          const media = getLegacyMedia(snapshot, metadata);
          const stored = media
            ? await storeMedia(media, String(node.type))
            : null;
          const element = legacyNodeElement(node, stored?.url);
          if (!element) {
            report.push(
              `项目 ${project.id} 节点 ${node.id}：缺少本地媒体，未请求远程链接。`
            );
            continue;
          }
          if (Array.isArray(metadata.images) && metadata.images.length > 1)
            report.push(
              `节点 ${node.id}：仅转换主图，多图槽位及其文件保留在备份中。`
            );
          element.legacyCanvasImportBatch = batchId;
          elements.push(element);
          ids.set(String(node.id), element.id);
          if (metadata.workflowTasks || metadata.status === 'loading')
            report.push(`节点 ${node.id}：历史任务仅保留资料，未重新提交。`);
        } catch {
          failed = true;
          report.push(
            `项目 ${project.id} 节点 ${node.id}：转换失败，本项目未写入，请检查备份和浏览器存储后重试。`
          );
          break;
        }
      }
      if (failed || !elements.length) continue;
      const name = `${String(project.name || '旧画布')}（导入 ${batchId}-${
        projectIndex + 1
      }）`;
      const board = await workspaceService.createBoard({ name, elements });
      try {
        const staged = createBoard(elements);
        for (const raw of Array.isArray(project.connections)
          ? project.connections
          : []) {
          const connection = record(raw);
          const from = ids.get(String(connection.fromNodeId));
          const to = ids.get(String(connection.toNodeId));
          if (from && to)
            createCanvasAssociationLines(staged, {
              boardId: board.id,
              sourceElementIds: [from],
              resultElementId: to,
            });
        }
        await workspaceService.saveBoard(board.id, {
          children: staged.children,
        });
        report.push(
          `项目 ${project.id} → 新画布 ${board.id}：${elements.length} 个元素；批次 ${batchId}。`
        );
      } catch (error) {
        await workspaceService.deleteBoard(board.id);
        throw error;
      }
    }
    const assets = snapshot.manifest.records.find(
      (row) => row.key === 'infinite-canvas:asset_store'
    );
    const savedAssets = record(record(parsed(assets?.value)).state).assets;
    for (const raw of Array.isArray(savedAssets) ? savedAssets : []) {
      const asset = record(raw);
      const data = record(asset.data);
      if (asset.kind === 'text') {
        await createPromptHistoryRecord({
          content: String(data.content || ''),
          title: String(asset.title || '旧文本素材'),
          category: 'text',
        });
        continue;
      }
      const kind = String(asset.kind);
      if (!['image', 'video', 'audio'].includes(kind)) {
        report.push(`素材 ${asset.id}：不支持的类型，仅保留备份。`);
        continue;
      }
      const media = getLegacyMedia(snapshot, {
        ...data,
        content: data.dataUrl || data.url,
      });
      if (!media) {
        report.push(`素材 ${asset.id}：缺少本地媒体，仅保留备份。`);
        continue;
      }
      const stored = await storeMedia(media, kind);
      await assetStorageService.addAsset({
        type:
          kind === 'image'
            ? AssetType.IMAGE
            : kind === 'video'
            ? AssetType.VIDEO
            : AssetType.AUDIO,
        source: AssetSource.LOCAL,
        name: String(asset.title || '旧素材'),
        blob: stored.blob,
        mimeType: stored.mime,
      });
      report.push(`素材 ${asset.id}：已导入素材库。`);
    }
    for (const row of snapshot.manifest.records.filter(
      (item) => item.store === 'prompt_cache'
    )) {
      const prompts = record(parsed(row.value)).items;
      for (const raw of Array.isArray(prompts) ? prompts : []) {
        const prompt = record(raw);
        if (typeof prompt.prompt !== 'string' || !prompt.prompt.trim())
          continue;
        await createPromptHistoryRecord({
          content: prompt.prompt,
          title: String(prompt.title || '旧提示词'),
          tags: ['旧数据导入'],
          category: 'image',
        });
      }
    }
    report.push(
      '导入结束；源库未修改。重复导入会创建新画布，素材/提示词按各自现有规则处理，不覆盖原记录。'
    );
    return report;
  } catch {
    report.push(
      '导入中断：已有成功记录在上方列出；当前新建画布已尝试回滚。原库未修改，请保留备份和报告，检查存储后重试。'
    );
    return report;
  } finally {
    importRunning = false;
  }
}
