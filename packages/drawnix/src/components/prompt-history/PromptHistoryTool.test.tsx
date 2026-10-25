// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskStatus } from '../../types/task.types';
import type {
  PromptHistoryPage,
  PromptHistoryQuery,
  PromptHistoryRecord,
} from '../../services/prompt-history-service';

const mockGetPromptHistoryPage = vi.fn<
  (query?: PromptHistoryQuery) => Promise<PromptHistoryPage>
>();
const mockMessage = {
  success: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
};
const mockSetPinned = vi.fn();
const mockDeletePrompts = vi.fn();
const mockUpdateRecord = vi.fn();
const mockCreateRecord = vi.fn();
const mockCopyToClipboard = vi.fn();

vi.mock('../../services/prompt-history-service', async () => {
  return {
    getPromptHistoryPage: mockGetPromptHistoryPage,
    setPromptHistoryPinned: mockSetPinned,
    deletePromptHistoryPrompts: mockDeletePrompts,
    updatePromptHistoryRecord: mockUpdateRecord,
    createPromptHistoryRecord: mockCreateRecord,
  };
});

vi.mock('tdesign-react', () => ({
  MessagePlugin: mockMessage,
}));

vi.mock('../../utils/runtime-helpers', () => ({
  copyToClipboard: mockCopyToClipboard,
}));

vi.mock('../shared/hover', () => ({
  HoverTip: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('../shared/media-preview', () => ({
  UnifiedMediaViewer: () => <div data-testid="media-viewer" />,
}));

vi.mock('../shared/VideoPosterPreview', () => ({
  VideoPosterPreview: () => <div data-testid="video-poster" />,
}));

vi.mock('../retry-image', () => ({
  RetryImage: ({ alt }: { alt?: string }) => <img alt={alt} />,
}));

function createRecord(
  overrides: Partial<PromptHistoryRecord> = {}
): PromptHistoryRecord {
  return {
    id: 'prompt-history-task-1',
    taskId: 'task-1',
    taskIds: ['task-1'],
    sourceSentPrompt: '发送提示词',
    sourceSentPrompts: ['发送提示词'],
    category: 'agent',
    status: TaskStatus.COMPLETED,
    title: '封面提示词',
    initialPrompt: '初始提示词',
    sentPrompt: '发送提示词',
    tags: ['agent', '封面 Skill'],
    skillName: '封面 Skill',
    createdAt: 1000,
    resultPreview: {
      kind: 'text',
      text: '结果摘要',
    },
    resultPreviews: [
      {
        kind: 'text',
        text: '结果摘要',
      },
    ],
    resultCount: 1,
    pinned: false,
    ...overrides,
  };
}

describe('PromptHistoryTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCopyToClipboard.mockResolvedValue(undefined);
    mockUpdateRecord.mockReturnValue(true);
    mockCreateRecord.mockReturnValue(true);
    mockGetPromptHistoryPage.mockImplementation(async (query) => ({
      records: [
        createRecord({
          id: query?.offset ? 'prompt-history-task-2' : 'prompt-history-task-1',
          taskId: query?.offset ? 'task-2' : 'task-1',
          title: query?.offset ? '第二条提示词' : '封面提示词',
        }),
      ],
      nextOffset: 30,
      hasMore: true,
      total: 2,
      skillTags: ['封面 Skill'],
    }));
  });

  afterEach(() => {
    cleanup();
  });

  it('支持分类筛选、Skill 筛选、搜索和分页加载', async () => {
    const { PromptHistoryTool } = await import('./PromptHistoryTool');

    render(<PromptHistoryTool />);

    await waitFor(() => {
      expect(mockGetPromptHistoryPage).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'all',
          skillTag: 'all',
          offset: 0,
          limit: 30,
        })
      );
    });
    expect(screen.getByText('共 2 条，已加载 1 条')).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: '发送提示词' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '图片' }));
    await waitFor(() => {
      expect(mockGetPromptHistoryPage).toHaveBeenLastCalledWith(
        expect.objectContaining({ category: 'image', offset: 0 })
      );
    });

    fireEvent.change(screen.getByPlaceholderText('搜索标题、提示词、标签'), {
      target: { value: '封面' },
    });
    await waitFor(() => {
      expect(mockGetPromptHistoryPage).toHaveBeenLastCalledWith(
        expect.objectContaining({ category: 'image', search: '封面', offset: 0 })
      );
    });

    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: '封面 Skill' },
    });
    await waitFor(() => {
      expect(mockGetPromptHistoryPage).toHaveBeenLastCalledWith(
        expect.objectContaining({ skillTag: '封面 Skill', offset: 0 })
      );
    });

    const tableWrap = document.querySelector<HTMLDivElement>(
      '.prompt-history-tool__table-wrap'
    );
    expect(tableWrap).toBeTruthy();
    if (!tableWrap) {
      throw new Error('table wrapper not found');
    }
    Object.defineProperty(tableWrap, 'scrollHeight', {
      configurable: true,
      value: 1000,
    });
    Object.defineProperty(tableWrap, 'clientHeight', {
      configurable: true,
      value: 500,
    });
    Object.defineProperty(tableWrap, 'scrollTop', {
      configurable: true,
      value: 450,
    });
    fireEvent.scroll(tableWrap);
    await waitFor(() => {
      expect(mockGetPromptHistoryPage).toHaveBeenLastCalledWith(
        expect.objectContaining({ offset: 30 })
      );
    });
  });

  it('从提示词选择器打开时按传入分类筛选', async () => {
    const { PromptHistoryTool } = await import('./PromptHistoryTool');

    render(<PromptHistoryTool initialCategory="video" />);

    await waitFor(() => {
      expect(mockGetPromptHistoryPage).toHaveBeenCalledWith(
        expect.objectContaining({
          category: 'video',
          skillTag: 'all',
          offset: 0,
          limit: 30,
        })
      );
    });
    expect(
      screen.getByRole('button', { name: '视频' }).className
    ).toContain('is-active');
  });

  it('支持多选删除和右侧置顶', async () => {
    const { PromptHistoryTool } = await import('./PromptHistoryTool');

    render(<PromptHistoryTool />);

    fireEvent.click(await screen.findByLabelText('选择 封面提示词'));
    fireEvent.click(screen.getByRole('button', { name: '删除 1 条' }));

    await waitFor(() => {
      expect(mockDeletePrompts).toHaveBeenCalledWith(['发送提示词']);
    });

    fireEvent.click(await screen.findByRole('button', { name: '置顶' }));
    expect(mockSetPinned).toHaveBeenCalledWith('发送提示词', true, 'agent');
  });

  it('点击提示词复制，点击非复选框列不切换选中', async () => {
    const { PromptHistoryTool } = await import('./PromptHistoryTool');

    render(<PromptHistoryTool />);

    fireEvent.click(await screen.findByText('封面提示词'));
    expect(screen.queryByRole('button', { name: '删除 1 条' })).toBeNull();

    fireEvent.click(
      screen.getByRole('button', { name: '复制提示词：封面提示词' })
    );
    await waitFor(() => {
      expect(mockCopyToClipboard).toHaveBeenCalledWith('发送提示词');
    });
    expect(mockMessage.success).toHaveBeenCalledWith('提示词已复制');
  });

  it('支持编辑标题和多标签，且不修改发送提示词', async () => {
    const { PromptHistoryTool } = await import('./PromptHistoryTool');

    render(<PromptHistoryTool />);

    fireEvent.click(await screen.findByRole('button', { name: '编辑 封面提示词' }));

    fireEvent.change(screen.getByPlaceholderText('输入标题'), {
      target: { value: '新标题' },
    });
    expect(screen.getByPlaceholderText('输入发送提示词')).toHaveProperty(
      'readOnly',
      true
    );
    fireEvent.change(screen.getByPlaceholderText('多个标签用逗号或换行分隔'), {
      target: { value: '标签一, 标签二\n标签一' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(mockUpdateRecord).toHaveBeenCalledWith({
      sourceSentPrompt: '发送提示词',
      sourceSentPrompts: ['发送提示词'],
      title: '新标题',
      sentPrompt: '发送提示词',
      tags: ['标签一', '标签二'],
      category: 'agent',
    });
    expect(mockMessage.success).toHaveBeenCalledWith('提示词已更新');
  });

  it('无结果记录支持编辑发送提示词', async () => {
    mockGetPromptHistoryPage.mockImplementation(async () => ({
      records: [
        createRecord({
          id: 'prompt-history-manual-1',
          taskId: 'manual-1',
          taskIds: [],
          sourceSentPrompt: '旧发送提示词',
          sourceSentPrompts: ['旧发送提示词'],
          title: '无结果提示词',
          initialPrompt: '旧发送提示词',
          sentPrompt: '旧发送提示词',
          tags: ['text'],
          category: 'text',
          resultPreview: { kind: 'none', text: '暂无结果' },
          resultPreviews: [],
          resultCount: 0,
        }),
      ],
      nextOffset: 1,
      hasMore: false,
      total: 1,
      skillTags: [],
    }));

    const { PromptHistoryTool } = await import('./PromptHistoryTool');

    render(<PromptHistoryTool />);

    fireEvent.click(
      await screen.findByRole('button', { name: '编辑 无结果提示词' })
    );

    const sentPromptInput = screen.getByPlaceholderText('输入发送提示词');
    expect(sentPromptInput).toHaveProperty('readOnly', false);
    fireEvent.change(sentPromptInput, {
      target: { value: '新发送提示词' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(mockUpdateRecord).toHaveBeenCalledWith({
      sourceSentPrompt: '旧发送提示词',
      sourceSentPrompts: ['旧发送提示词'],
      title: '无结果提示词',
      sentPrompt: '新发送提示词',
      tags: ['text'],
      category: 'text',
      allowSentPromptEdit: true,
    });
  });

  it('支持从右上角创建空白提示词，默认类型为 text', async () => {
    const { PromptHistoryTool } = await import('./PromptHistoryTool');

    render(<PromptHistoryTool />);

    fireEvent.click(await screen.findByRole('button', { name: '新建提示词' }));

    expect(screen.getByText('创建提示词')).toBeTruthy();
    expect(screen.getByPlaceholderText('输入标题')).toHaveProperty('value', '');
    expect(screen.getByPlaceholderText('输入发送提示词')).toHaveProperty(
      'value',
      ''
    );
    expect(
      document.querySelector('.prompt-history-tool__switch-field input')
    ).toHaveProperty('checked', false);
    expect(screen.getByLabelText('类型')).toHaveProperty('value', 'text');

    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(mockCreateRecord).not.toHaveBeenCalled();
    expect(mockMessage.warning).toHaveBeenCalledWith('发送提示词不能为空');
  });

  it('支持基于行复制创建并预填当前行内容', async () => {
    const { PromptHistoryTool } = await import('./PromptHistoryTool');

    render(<PromptHistoryTool />);

    fireEvent.click(
      await screen.findByRole('button', { name: '基于 封面提示词 创建' })
    );

    expect(screen.getByPlaceholderText('输入标题')).toHaveProperty(
      'value',
      '封面提示词'
    );
    expect(screen.getByPlaceholderText('输入发送提示词')).toHaveProperty(
      'value',
      '发送提示词'
    );
    expect(screen.getByLabelText('类型')).toHaveProperty('value', 'agent');
    expect(screen.getByPlaceholderText('多个标签用逗号或换行分隔')).toHaveProperty(
      'value',
      'agent, 封面 Skill'
    );
  });

  it('创建保存时调用 createPromptHistoryRecord', async () => {
    const { PromptHistoryTool } = await import('./PromptHistoryTool');

    render(<PromptHistoryTool />);

    fireEvent.click(await screen.findByRole('button', { name: '新建提示词' }));
    fireEvent.change(screen.getByPlaceholderText('输入标题'), {
      target: { value: '新建标题' },
    });
    fireEvent.change(screen.getByPlaceholderText('输入发送提示词'), {
      target: { value: '新建发送提示词' },
    });
    fireEvent.change(screen.getByPlaceholderText('多个标签用逗号或换行分隔'), {
      target: { value: '标签一,标签二' },
    });
    const pinnedInput = document.querySelector<HTMLInputElement>(
      '.prompt-history-tool__switch-field input'
    );
    expect(pinnedInput).toBeTruthy();
    if (!pinnedInput) {
      throw new Error('pinned input not found');
    }
    fireEvent.click(pinnedInput);
    fireEvent.click(screen.getByRole('button', { name: '保存' }));

    expect(mockCreateRecord).toHaveBeenCalledWith({
      title: '新建标题',
      content: '新建发送提示词',
      tags: ['标签一', '标签二'],
      category: 'text',
      pinned: true,
    });
    expect(mockMessage.success).toHaveBeenCalledWith('提示词已创建');
  });
});
