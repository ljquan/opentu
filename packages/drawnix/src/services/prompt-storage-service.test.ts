import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => new Map<string, unknown>());

vi.mock('./kv-storage-service', () => ({
  kvStorageService: {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
    }),
    remove: vi.fn(async (key: string) => {
      store.delete(key);
    }),
  },
}));

async function loadService() {
  vi.resetModules();
  return import('./prompt-storage-service');
}

describe('prompt-storage-service', () => {
  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
  });

  it('stores edited prompt content and resolves source content to the edited value', async () => {
    const service = await loadService();
    await service.initPromptStorageCache();

    const override = service.setPromptHistoryOverride(' 原始提示词 ', {
      title: ' 用户标题 ',
      sentPrompt: ' 编辑后的提示词 ',
      tags: [' 标签一 ', '标签一', '', '标签二'],
      modelType: 'image',
    });

    expect(override).toMatchObject({
      sourceContent: '原始提示词',
      content: '编辑后的提示词',
      title: '用户标题',
      tags: ['标签一', '标签二'],
      modelType: 'image',
    });
    expect(service.resolvePromptContent('原始提示词')).toBe('编辑后的提示词');
    expect(service.resolvePromptMetadata('原始提示词')).toMatchObject({
      sourceContent: '原始提示词',
      content: '编辑后的提示词',
      title: '用户标题',
      tags: ['标签一', '标签二'],
      modelType: 'image',
    });
    expect(service.resolvePromptMetadata('编辑后的提示词')).toMatchObject({
      sourceContent: '原始提示词',
      content: '编辑后的提示词',
      title: '用户标题',
      tags: ['标签一', '标签二'],
      modelType: 'image',
    });
    expect(service.getPromptHistoryOverride('原始提示词')?.content).toBe(
      '编辑后的提示词'
    );
  });

  it('resolves metadata from original content when no override exists', async () => {
    const service = await loadService();
    await service.initPromptStorageCache();

    expect(service.resolvePromptMetadata(' 原始提示词 ')).toEqual({
      sourceContent: '原始提示词',
      content: '原始提示词',
      title: undefined,
      tags: undefined,
      modelType: undefined,
    });
  });

  it('updates title and tags without replacing existing edited content', async () => {
    const service = await loadService();
    await service.initPromptStorageCache();

    service.setPromptHistoryOverride('原始提示词', {
      sentPrompt: '编辑后的提示词',
      modelType: 'image',
    });
    service.setPromptHistoryOverride('原始提示词', {
      title: '新标题',
      tags: ['收藏'],
      modelType: 'image',
    });

    expect(service.resolvePromptMetadata('原始提示词')).toMatchObject({
      sourceContent: '原始提示词',
      content: '编辑后的提示词',
      title: '新标题',
      tags: ['收藏'],
      modelType: 'image',
    });
  });

  it('migrates pinned state from source content to edited content', async () => {
    const service = await loadService();
    await service.initPromptStorageCache();

    service.setPromptContentPinned('原始提示词', true, 'image');
    expect(service.isPromptContentPinned('原始提示词')).toBe(true);

    expect(
      service.setPromptContentEdited(['原始提示词'], '编辑后的提示词', 'image')
    ).toBe(true);

    expect(service.resolvePromptContent('原始提示词')).toBe('编辑后的提示词');
    expect(service.isPromptContentPinned('原始提示词')).toBe(false);
    expect(service.isPromptContentPinned('编辑后的提示词')).toBe(true);
    expect(
      service.promptStorageService.sortPrompts('image', [
        '普通提示词',
        '编辑后的提示词',
      ])
    ).toEqual(['编辑后的提示词', '普通提示词']);
  });

  it('does not create dirty history when unpinning missing content', async () => {
    const service = await loadService();
    await service.initPromptStorageCache();

    expect(
      service.setPromptContentPinned('不存在的提示词', false, 'image')
    ).toBe(false);
    expect(service.getPromptHistory()).toEqual([]);
  });

  it('keeps selector pin state synchronized with content pin state', async () => {
    const service = await loadService();
    await service.initPromptStorageCache();

    service.promptStorageService.pinPrompt('image', '图片提示词');
    expect(service.promptStorageService.isPinned('image', '图片提示词')).toBe(
      true
    );
    expect(service.promptStorageService.isContentPinned('图片提示词')).toBe(
      true
    );

    service.promptStorageService.unpinPrompt('image', '图片提示词');
    expect(service.promptStorageService.isPinned('image', '图片提示词')).toBe(
      false
    );
    expect(service.promptStorageService.isContentPinned('图片提示词')).toBe(
      false
    );
  });

  it('uses content pin as source of truth and clears stale preset pin order', async () => {
    const service = await loadService();
    await service.initPromptStorageCache();

    service.promptStorageService.pinPrompt('image', '跨入口提示词');
    expect(service.promptStorageService.isPinned('image', '跨入口提示词')).toBe(
      true
    );

    service.setPromptContentPinned('跨入口提示词', false, 'image');

    expect(service.promptStorageService.isPinned('image', '跨入口提示词')).toBe(
      false
    );
    expect(
      service.promptStorageService.getPresetSettings('image').pinnedPrompts
    ).not.toContain('跨入口提示词');
    expect(
      service.promptStorageService.sortPrompts('image', [
        '普通提示词',
        '跨入口提示词',
      ])
    ).toEqual(['普通提示词', '跨入口提示词']);
  });

  it('notifies prompt storage changes once per microtask', async () => {
    const service = await loadService();
    await service.initPromptStorageCache();
    const listener = vi.fn();

    const unsubscribe = service.promptStorageService.subscribeChanges(listener);
    service.addPromptHistory('新增提示词', false, 'image');
    service.setPromptHistoryOverride('新增提示词', {
      title: '新标题',
      sentPrompt: '新增提示词',
      modelType: 'image',
    });

    expect(listener).not.toHaveBeenCalled();
    await Promise.resolve();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toMatchObject({
      version: 1,
      types: expect.arrayContaining(['history', 'metadata']),
    });

    unsubscribe();
    service.addPromptHistory('第二条提示词', false, 'image');
    await Promise.resolve();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('shares content pin state across media and PPT prompt selectors', async () => {
    const service = await loadService();
    await service.initPromptStorageCache();

    service.setPromptContentPinned('跨场景提示词', true, 'ppt-slide');

    for (const type of [
      'image',
      'video',
      'text',
      'agent',
      'audio',
      'ppt-common',
      'ppt-slide',
    ] as const) {
      expect(service.promptStorageService.isPinned(type, '跨场景提示词')).toBe(
        true
      );
    }

    expect(
      service.promptStorageService.sortPrompts('ppt-slide', [
        '普通页面提示词',
        '跨场景提示词',
      ])
    ).toEqual(['跨场景提示词', '普通页面提示词']);
  });

  it('clears generation history while preserving prompt preferences', async () => {
    store.set('aitu_prompt_history', [{ content: '文本历史' }]);
    store.set('aitu_video_prompt_history', [{ prompt: '视频历史' }]);
    store.set('aitu_image_prompt_history', [{ prompt: '图片历史' }]);
    store.set('aitu_prompt_deleted_contents', ['已删除历史']);
    store.set('aitu_prompt_history_overrides', [{ content: '编辑历史' }]);
    store.set('aitu-prompt-preset-settings', { image: { pinnedPrompts: [] } });
    const service = await loadService();
    await service.initPromptStorageCache();

    await service.clearGenerationPromptHistory();

    expect(store.has('aitu_prompt_history')).toBe(false);
    expect(store.has('aitu_video_prompt_history')).toBe(false);
    expect(store.has('aitu_image_prompt_history')).toBe(false);
    expect(store.has('aitu_prompt_deleted_contents')).toBe(true);
    expect(store.has('aitu_prompt_history_overrides')).toBe(true);
    expect(store.has('aitu-prompt-preset-settings')).toBe(true);
  });
});
