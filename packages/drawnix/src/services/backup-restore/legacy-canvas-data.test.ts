import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  exportLegacyCanvasData,
  getLegacyMedia,
  getLegacyProjects,
  importLegacyCanvasData,
  legacyNodeElement,
  loadLegacyCanvasArchive,
  sanitizeLegacyData,
  validateLegacyManifest,
  type LegacyCanvasSnapshot,
} from './legacy-canvas-data';
const mocks = vi.hoisted(() => ({
  createBoard: vi.fn(),
  saveBoard: vi.fn(),
  deleteBoard: vi.fn(),
  cache: vi.fn(),
  asset: vi.fn(),
  prompt: vi.fn(),
}));
vi.mock('../workspace-service', () => ({
  workspaceService: {
    initialize: vi.fn(),
    createBoard: mocks.createBoard,
    saveBoard: mocks.saveBoard,
    deleteBoard: mocks.deleteBoard,
  },
}));
vi.mock('../unified-cache-service', () => ({
  unifiedCacheService: {
    cacheMediaFromBlob: mocks.cache,
    getCachedBlob: vi.fn(
      async () => new Blob(['image'], { type: 'image/png' })
    ),
  },
}));
vi.mock('../asset-storage-service', () => ({
  assetStorageService: { addAsset: mocks.asset },
}));
vi.mock('../prompt-history-service', () => ({
  createPromptHistoryRecord: mocks.prompt,
}));
function snapshot(nodes: unknown[] = []): LegacyCanvasSnapshot {
  return {
    manifest: {
      app: 'opentu-legacy-canvas',
      version: 1,
      warnings: [],
      records: [
        {
          database: 'infinite-canvas',
          store: 'app_state',
          key: 'infinite-canvas:canvas_store',
          value: {
            state: {
              projects: [
                { id: 'old', name: 'example', nodes, connections: [] },
              ],
            },
            version: 0,
          },
        },
      ],
    },
    files: new Map(),
  };
}
const textNode = {
  id: 'text',
  type: 'text',
  title: 'Note',
  position: { x: 12, y: 32 },
  width: 200,
  height: 100,
  metadata: { content: 'hello', prompt: 'original' },
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.createBoard.mockResolvedValue({ id: 'new-board' });
  mocks.saveBoard.mockResolvedValue(undefined);
});
describe('legacy data compatibility', () => {
  it('removes nested credentials, JSON strings, known values and executable code', () => {
    const cleaned = sanitizeLegacyData(
      {
        apiKey: 'sensitive',
        nested: '{"password":"hidden","title":"safe"}',
        note: 'has sensitive',
        source: 'executable',
        url: 'https://name:pass@example.test/media?token=hidden&size=10',
      },
      ['sensitive']
    );
    expect(JSON.stringify(cleaned)).not.toMatch(
      /sensitive|hidden|executable|name:pass/
    );
    expect(cleaned).toMatchObject({
      nested: { title: 'safe' },
      note: 'has [已移除凭据]',
    });
  });
  it('rejects unknown versions, duplicate records and unsafe file paths', () => {
    expect(() =>
      validateLegacyManifest({ ...snapshot().manifest, version: 4 })
    ).toThrow();
    const data = snapshot().manifest;
    expect(() =>
      validateLegacyManifest({
        ...data,
        records: [...data.records, ...data.records],
      })
    ).toThrow();
    expect(() =>
      validateLegacyManifest({
        ...data,
        records: [{ database: 'x', store: 'x', key: 'x', file: '../secret' }],
      })
    ).toThrow();
  });
  it('reads archived blobs without fetching old remote URLs', () => {
    const data = snapshot();
    const blob = new Blob(['image'], { type: 'image/png' });
    data.manifest.records.push({
      database: 'infinite-canvas',
      store: 'image_files',
      key: 'image:one',
      file: 'media/0',
    });
    data.files.set('media/0', blob);
    expect(
      getLegacyMedia(data, { storageKey: 'image:one', content: 'blob:expired' })
    ).toBe(blob);
    expect(
      getLegacyMedia(data, { content: 'https://example.test/old' })
    ).toBeNull();
  });
  it('keeps positions, dimensions and generation prompts on converted elements', () => {
    expect(legacyNodeElement(textNode)).toMatchObject({
      type: 'card',
      body: 'hello',
      prompt: 'original',
      points: [
        [12, 32],
        [212, 132],
      ],
    });
    expect(() => legacyNodeElement({ ...textNode, width: -1 })).toThrow();
  });
  it('exports a ZIP manifest and rejects archives missing media', async () => {
    const data = snapshot([textNode]);
    // Node Buffer is supported by JSZip in jsdom; Blob round-trip is exercised separately in browsers.
    const exported = await exportLegacyCanvasData(data);
    expect(exported.size).toBeGreaterThan(0);
    const zip = (await import('jszip')).default;
    const broken = new zip();
    broken.file(
      'legacy-canvas.json',
      JSON.stringify({
        ...data.manifest,
        records: [{ database: 'x', store: 'x', key: 'x', file: 'media/0' }],
      })
    );
    await expect(
      loadLegacyCanvasArchive(
        (await broken.generateAsync({ type: 'nodebuffer' })) as unknown as Blob
      )
    ).rejects.toThrow('备份媒体缺失');
  });
  it('round-trips archived image bytes and MIME types with redacted configuration', async () => {
    const data = snapshot([textNode]);
    data.manifest.records.push({
      database: 'infinite-canvas',
      store: 'image_files',
      key: 'image:one',
      file: 'media/0',
      mimeType: 'image/png',
    });
    data.files.set('media/0', new Blob(['image'], { type: 'image/png' }));
    data.manifest.records.push({
      database: 'infinite-canvas',
      store: 'app_state',
      key: 'settings',
      value: { apiKey: 'do-not-export', title: 'keep' },
    });
    const blob = await exportLegacyCanvasData(data);
    const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = reject;
      reader.readAsArrayBuffer(blob);
    });
    const restored = await loadLegacyCanvasArchive(bytes as unknown as Blob);
    expect(restored.files.get('media/0')?.size).toBe(5);
    expect(restored.files.get('media/0')?.type).toBe('image/png');
    expect(JSON.stringify(restored.manifest)).not.toContain('do-not-export');
    expect(getLegacyProjects(restored)).toHaveLength(1);
  });
  it('refuses malformed project data before writing anything', async () => {
    const data = snapshot();
    data.manifest.records[0].value = { version: 2, state: { projects: [] } };
    expect(() => getLegacyProjects(data)).toThrow();
    await expect(importLegacyCanvasData(data)).rejects.toThrow();
    expect(mocks.createBoard).not.toHaveBeenCalled();
  });
  it('creates new boards on repeated imports and never sends network generation requests', async () => {
    const data = snapshot([
      textNode,
      { id: 'config', type: 'config' },
      {
        ...textNode,
        id: 'remote',
        type: 'image',
        metadata: { content: 'https://example.test/old', status: 'loading' },
      },
    ]);
    const original = JSON.stringify(data.manifest);
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('no network'));
    try {
      const report = await importLegacyCanvasData(data);
      await importLegacyCanvasData(data);
      expect(mocks.createBoard).toHaveBeenCalledTimes(2);
      expect(mocks.createBoard.mock.calls[0][0].name).not.toBe(
        mocks.createBoard.mock.calls[1][0].name
      );
      expect(report.join('\n')).toContain('缺少本地媒体');
      expect(JSON.stringify(data.manifest)).toBe(original);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
  it('does not write a partial project after an invalid node', async () => {
    await importLegacyCanvasData(
      snapshot([textNode, { ...textNode, id: 'bad', width: -1 }])
    );
    expect(mocks.createBoard).not.toHaveBeenCalled();
  });
  it('rolls back a newly created board when its final save fails', async () => {
    mocks.saveBoard.mockRejectedValueOnce(new Error('storage full'));
    expect(
      (await importLegacyCanvasData(snapshot([textNode]))).join('\n')
    ).toContain('导入中断');
    expect(mocks.deleteBoard).toHaveBeenCalledWith('new-board');
  });
});
