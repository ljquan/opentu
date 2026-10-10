// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { getDefaultPromptsByGenerationType } from '../../constants/prompts';

const mockPromptListPanel = vi.fn();
const mockOpenTool = vi.hoisted(() => vi.fn());
const promptStorageMockState = vi.hoisted(() => ({
  imagePrompts: ['本地图片历史'],
  videoPrompts: ['本地视频历史'],
  listeners: new Set<(event: { version: number; types: string[] }) => void>(),
}));

const historyRecords = [
  { id: 'image-1', content: 'AI 输入图片历史', timestamp: 100, modelType: 'image' },
  { id: 'video-1', content: 'AI 输入视频历史', timestamp: 200, modelType: 'video' },
  { id: 'audio-1', content: 'AI 输入音频历史', timestamp: 300, modelType: 'audio' },
  { id: 'text-1', content: 'AI 输入文本历史', timestamp: 400, modelType: 'text' },
  { id: 'agent-1', content: 'AI 输入 Agent 历史', timestamp: 500, modelType: 'agent' },
];

vi.mock('../../hooks/usePromptHistory', () => ({
  usePromptHistory: (options?: { modelTypeFilter?: string }) => ({
    history: options?.modelTypeFilter
      ? historyRecords.filter(
          (item) => item.modelType === options.modelTypeFilter
        )
      : historyRecords,
    removeHistory: vi.fn(),
    togglePinHistory: vi.fn(),
    refreshHistory: vi.fn(),
  }),
}));

vi.mock('../../hooks/useGenerationHistory', () => ({
  useGenerationHistory: () => ({
    imageHistory: [
      {
        id: 'task-image-1',
        prompt: '任务图片历史',
        timestamp: 600,
        imageUrl: '/task-image.png',
        width: 1024,
        height: 1024,
      },
    ],
    videoHistory: [
      {
        id: 'task-video-1',
        prompt: '任务视频历史',
        timestamp: 700,
        imageUrl: '/task-video-thumb.png',
        previewUrl: '/task-video.mp4',
        downloadUrl: '/task-video.mp4',
        width: 1280,
        height: 720,
      },
    ],
  }),
}));

vi.mock('../dialog/ConfirmDialog', () => ({
  useConfirmDialog: () => ({
    confirm: vi.fn(),
    confirmDialog: null,
  }),
}));

vi.mock('../shared', () => ({
  PromptListPanel: ({
    title,
    items,
    onTitleClick,
  }: {
    title: string;
    items: Array<{
      id: string;
      content: string;
      previewExamples?: Array<{ src: string; alt: string }>;
    }>;
    onTitleClick?: () => void;
  }) => {
    mockPromptListPanel({ title, items, onTitleClick });
    return (
      <div data-testid="prompt-list-panel">
        <button type="button" onClick={onTitleClick}>
          {title}
        </button>
        {items.map((item) => (
          <div key={item.id}>{item.content}</div>
        ))}
      </div>
    );
  },
}));

vi.mock('../shared/hover', () => ({
  HoverTip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../services/tool-window-service', () => ({
  toolWindowService: {
    openTool: mockOpenTool,
    getToolState: vi.fn(),
  },
}));

vi.mock('../../tools/registry', () => ({
  toolRegistry: {
    getManifestById: (id: string) =>
      id === 'prompt-history'
        ? {
            id: 'prompt-history',
            name: '我的提示词',
            component: 'prompt-history',
          }
        : null,
    isBuiltInTool: (id: string) => id === 'prompt-history',
  },
}));

vi.mock('../../services/prompt-storage-service', () => ({
  getImagePromptHistoryContents: () => promptStorageMockState.imagePrompts,
  getVideoPromptHistoryContents: () => promptStorageMockState.videoPrompts,
  promptStorageService: {
    sortPrompts: (_type: string, prompts: string[]) => prompts,
    isPinned: () => false,
    resolveContent: (content: string) => content.trim(),
    pinPrompt: vi.fn(),
    unpinPrompt: vi.fn(),
    deletePrompt: vi.fn(),
    subscribeChanges: vi.fn(
      (listener: (event: { version: number; types: string[] }) => void) => {
        promptStorageMockState.listeners.add(listener);
        return () => {
          promptStorageMockState.listeners.delete(listener);
        };
      }
    ),
  },
}));

describe('PromptHistoryPopover', () => {
  it('点击后在输入区之外显示面板，Escape 关闭', async () => {
    const { PromptHistoryPopover } = await import('./PromptHistoryPopover');
    const view = render(
      <PromptHistoryPopover
        generationType="image"
        language="zh"
        onSelectPrompt={vi.fn()}
      />
    );
    const trigger = screen.getByRole('button', { name: '我的提示词' });
    await act(async () => {
      fireEvent.click(trigger);
    });
    const panel = document.querySelector(
      '.prompt-history-popover__panel-wrapper'
    );
    expect(panel).not.toBeNull();
    expect(view.container.contains(panel)).toBe(false);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    expect(
      document.querySelector('.prompt-history-popover__panel-wrapper')
    ).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  const openPopover = async (container: HTMLElement) => {
    await act(async () => {
      fireEvent.mouseEnter(
        container.querySelector(
          '.prompt-history-popover__trigger'
        ) as HTMLElement
      );
      await vi.advanceTimersByTimeAsync(200);
    });
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    promptStorageMockState.imagePrompts = ['本地图片历史'];
    promptStorageMockState.videoPrompts = ['本地视频历史'];
    promptStorageMockState.listeners.clear();
    mockOpenTool.mockClear();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    cleanup();
  });

  const triggerPromptStorageChange = () => {
    act(() => {
      promptStorageMockState.listeners.forEach((listener) => {
        listener({ version: 1, types: ['history'] });
      });
    });
  };

  it('图片模式只显示图片提示词来源', async () => {
    const { PromptHistoryPopover } = await import('./PromptHistoryPopover');

    const view = render(
      <PromptHistoryPopover
        generationType="image"
        onSelectPrompt={vi.fn()}
        language="zh"
      />
    );

    await openPopover(view.container);

    expect(screen.getByText('本地图片历史')).toBeTruthy();
    expect(screen.getByText('任务图片历史')).toBeTruthy();
    expect(screen.queryByText('本地视频历史')).toBeNull();
    expect(screen.queryByText('任务视频历史')).toBeNull();
    expect(screen.queryByText('AI 输入视频历史')).toBeNull();
    expect(screen.queryByText('AI 输入音频历史')).toBeNull();
  });

  it('切换到音频模式后只显示音频提示词', async () => {
    const { PromptHistoryPopover } = await import('./PromptHistoryPopover');

    const view = render(
      <PromptHistoryPopover
        generationType="audio"
        onSelectPrompt={vi.fn()}
        language="zh"
      />
    );

    await openPopover(view.container);

    expect(screen.getByText('AI 输入音频历史')).toBeTruthy();
    expect(screen.queryByText('AI 输入图片历史')).toBeNull();
    expect(screen.queryByText('AI 输入视频历史')).toBeNull();
    expect(screen.queryByText('AI 输入文本历史')).toBeNull();
    expect(screen.queryByText('AI 输入 Agent 历史')).toBeNull();
  });

  it('切换到 Agent 模式后只显示 Agent 提示词', async () => {
    const { PromptHistoryPopover } = await import('./PromptHistoryPopover');

    const view = render(
      <PromptHistoryPopover
        generationType="agent"
        onSelectPrompt={vi.fn()}
        language="zh"
      />
    );

    await openPopover(view.container);

    expect(screen.getByText('AI 输入 Agent 历史')).toBeTruthy();
    expect(screen.queryByText('AI 输入图片历史')).toBeNull();
    expect(screen.queryByText('AI 输入视频历史')).toBeNull();
    expect(screen.queryByText('AI 输入音频历史')).toBeNull();
  });

  it.each(['audio', 'text', 'agent'] as const)(
    '%s 模式不会给默认提示词附加内置预览',
    async (generationType) => {
      const { PromptHistoryPopover } = await import('./PromptHistoryPopover');

      const view = render(
        <PromptHistoryPopover
          generationType={generationType}
          onSelectPrompt={vi.fn()}
          language="zh"
        />
      );

      await openPopover(view.container);

      const items = mockPromptListPanel.mock.calls.at(-1)?.[0]?.items as
        | Array<{
            content: string;
            previewExamples?: Array<{ src: string }>;
          }>
        | undefined;

      const defaultPromptItem = items?.find(
        (item) =>
          item.content ===
          getDefaultPromptsByGenerationType(generationType, 'zh')[0]
      );

      expect(defaultPromptItem?.previewExamples).toBeUndefined();
    }
  );

  it('视频模式不会给默认提示词附加内置样片', async () => {
    const { PromptHistoryPopover } = await import('./PromptHistoryPopover');

    const view = render(
      <PromptHistoryPopover
        generationType="video"
        onSelectPrompt={vi.fn()}
        language="zh"
      />
    );

    await openPopover(view.container);

    const items = mockPromptListPanel.mock.calls.at(-1)?.[0]?.items as
      | Array<{
          content: string;
          previewExamples?: Array<{
            kind?: string;
            src: string;
            posterSrc?: string;
          }>;
        }>
      | undefined;

    const defaultPromptItem = items?.find(
      (item) => item.content === getDefaultPromptsByGenerationType('video', 'zh')[0]
    );

    expect(defaultPromptItem?.previewExamples).toEqual([]);
  });

  it('视频模式会给用户生成历史附加真实视频预览', async () => {
    const { PromptHistoryPopover } = await import('./PromptHistoryPopover');

    const view = render(
      <PromptHistoryPopover
        generationType="video"
        onSelectPrompt={vi.fn()}
        language="zh"
      />
    );

    await openPopover(view.container);

    const items = mockPromptListPanel.mock.calls.at(-1)?.[0]?.items as
      | Array<{
          content: string;
          previewExamples?: Array<{
            kind?: string;
            src: string;
            posterSrc?: string;
            playable?: boolean;
          }>;
        }>
      | undefined;

    const generatedVideoItem = items?.find(
      (item) => item.content === '任务视频历史'
    );

    expect(generatedVideoItem?.previewExamples?.[0]).toMatchObject({
      kind: 'video',
      src: '/task-video.mp4',
      posterSrc: '/task-video-thumb.png',
      playable: true,
    });
  });

  it('提示词存储广播后重新计算并刷新列表', async () => {
    const { PromptHistoryPopover } = await import('./PromptHistoryPopover');

    const view = render(
      <PromptHistoryPopover
        generationType="image"
        onSelectPrompt={vi.fn()}
        language="zh"
      />
    );

    await openPopover(view.container);

    const initialCallCount = mockPromptListPanel.mock.calls.length;
    expect(screen.getByText('本地图片历史')).toBeTruthy();

    promptStorageMockState.imagePrompts = ['广播后的本地图片历史'];
    triggerPromptStorageChange();

    expect(mockPromptListPanel.mock.calls.length).toBeGreaterThan(
      initialCallCount
    );
    expect(screen.getByText('广播后的本地图片历史')).toBeTruthy();
    expect(screen.queryByText('本地图片历史')).toBeNull();
  });

  it('标题显示为我的提示词，点击后打开我的提示词弹窗', async () => {
    const { PromptHistoryPopover } = await import('./PromptHistoryPopover');
    const onBeforeOpenMyPrompts = vi.fn();

    const view = render(
      <PromptHistoryPopover
        generationType="image"
        onSelectPrompt={vi.fn()}
        language="zh"
        onBeforeOpenMyPrompts={onBeforeOpenMyPrompts}
      />
    );

    await openPopover(view.container);

    expect(screen.getByText('我的提示词')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByText('我的提示词'));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onBeforeOpenMyPrompts).toHaveBeenCalledTimes(1);
    expect(mockOpenTool).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'prompt-history',
        name: '我的提示词',
      }),
      {
        componentProps: {
          initialCategory: 'image',
        },
      }
    );
  });
});
