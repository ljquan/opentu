// @vitest-environment jsdom
import React from 'react';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Task } from '../../types/task.types';
import {
  PptExplainerDialog,
  type PptExplainerDialogDraft,
  validatePptExplainerDialogDraft,
} from './PptExplainerDialog';

const mocks = vi.hoisted(() => ({
  confirm: vi.fn(),
  success: vi.fn(),
}));

vi.mock('../dialog/ConfirmDialog', () => ({
  useConfirmDialog: () => ({
    confirm: mocks.confirm,
    confirmDialog: null,
  }),
}));

vi.mock('lucide-react', () => ({
  FileAudio: () => <span aria-hidden="true" />,
  FileUp: () => <span aria-hidden="true" />,
  Library: () => <span aria-hidden="true" />,
  Trash2: () => <span aria-hidden="true" />,
}));

vi.mock('../media-library/MediaLibraryModal', () => ({
  MediaLibraryModal: ({
    isOpen,
    onSelect,
  }: {
    isOpen: boolean;
    onSelect: (asset: unknown) => void;
  }) =>
    isOpen ? (
      <button
        type="button"
        onClick={() =>
          onSelect({
            id: 'audio-asset-1',
            type: 'AUDIO',
            source: 'LOCAL',
            url: '/__aitu_cache__/audio/sample.mp3',
            name: '素材库样本.mp3',
            mimeType: 'audio/mpeg',
            size: 1234,
            createdAt: 1,
          })
        }
      >
        选择测试音频
      </button>
    ) : null,
}));

vi.mock('tdesign-react', () => ({
  Button: ({
    children,
    icon,
    onClick,
    disabled,
    loading,
    'aria-label': ariaLabel,
  }: {
    children?: React.ReactNode;
    icon?: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    loading?: boolean;
    'aria-label'?: string;
  }) => (
    <button
      type="button"
      aria-label={ariaLabel}
      disabled={disabled}
      data-loading={loading || undefined}
      onClick={onClick}
    >
      {icon}
      {children}
    </button>
  ),
  Checkbox: ({
    children,
    checked,
    disabled,
    onChange,
  }: {
    children?: React.ReactNode;
    checked?: boolean;
    disabled?: boolean;
    onChange?: (checked: boolean) => void;
  }) => (
    <label>
      <input
        type="checkbox"
        checked={Boolean(checked)}
        disabled={disabled}
        onChange={(event) => onChange?.(event.target.checked)}
      />
      {children}
    </label>
  ),
  Dialog: ({
    visible,
    header,
    children,
    footer,
  }: {
    visible: boolean;
    header: string;
    children: React.ReactNode;
    footer: React.ReactNode;
  }) =>
    visible ? (
      <div role="dialog" aria-label={header}>
        {children}
        {footer}
      </div>
    ) : null,
  Input: ({
    value,
    placeholder,
    disabled,
    onChange,
  }: {
    value?: string;
    placeholder?: string;
    disabled?: boolean;
    onChange?: (value: string) => void;
  }) => (
    <input
      value={value || ''}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(event) => onChange?.(event.target.value)}
    />
  ),
  Textarea: ({
    value,
    placeholder,
    disabled,
    onChange,
  }: {
    value?: string;
    placeholder?: string;
    disabled?: boolean;
    onChange?: (value: string) => void;
  }) => (
    <textarea
      value={value || ''}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(event) => onChange?.(event.target.value)}
    />
  ),
  Select: ({
    value,
    placeholder,
    disabled,
    onChange,
    options = [],
  }: {
    value?: string;
    placeholder?: string;
    disabled?: boolean;
    onChange?: (value: string) => void;
    options?: Array<{ value: string; label: string }>;
  }) => (
    <div>
      <input
        value={value || ''}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => onChange?.(event.target.value)}
      />
      {options.map((option) => (
        <span key={option.value}>{option.label}</span>
      ))}
    </div>
  ),
  MessagePlugin: {
    success: mocks.success,
  },
}));

const videoModelRef = { profileId: 'profile-1', modelId: 'video-1' };

function renderDialog(
  overrides: Partial<React.ComponentProps<typeof PptExplainerDialog>> = {}
) {
  const onCreate =
    overrides.onCreate || vi.fn().mockResolvedValue({ id: 'task-1' } as Task);
  const onClose = vi.fn();
  const rendered = render(
    <PptExplainerDialog
      open
      sourceBoardId="board-1"
      hasExistingPpt={false}
      initialTopic="季度复盘"
      textModel="text-1"
      imageModel="image-1"
      videoModel="video-1"
      videoModelRef={videoModelRef}
      onCreate={onCreate}
      onClose={onClose}
      {...overrides}
    />
  );
  return { onCreate, onClose, ...rendered };
}

describe('PptExplainerDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('跳过大纲时二次确认后才创建，并传递确认标记', async () => {
    mocks.confirm.mockResolvedValue(true);
    const { onCreate, onClose } = renderDialog();

    fireEvent.click(screen.getByRole('radio', { name: '直接生成' }));
    fireEvent.click(screen.getByRole('button', { name: '创建任务' }));

    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1));
    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '跳过大纲确认？',
        confirmText: '确认直接生成',
      })
    );
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'topic',
        topic: '季度复盘',
        reviewMode: 'skip_after_warning',
        presenterMode: 'single_voice',
        speakers: [
          expect.objectContaining({
            id: 'host',
            displayName: '主讲人',
          }),
        ],
      })
    );
    const submitted = onCreate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(submitted).not.toHaveProperty('executionMode');
    expect(submitted).not.toHaveProperty('providerBindingId');
    expect(submitted).not.toHaveProperty('voiceCloneConsent');
    expect(JSON.stringify(submitted.speakers)).not.toMatch(
      /voice|referenceAudio|avatar/i
    );
    expect(mocks.success).toHaveBeenCalledWith('PPT 讲解任务已创建');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('取消跳过警告时不创建且配置保持可编辑', async () => {
    mocks.confirm.mockResolvedValue(false);
    const { onCreate, onClose } = renderDialog();

    fireEvent.click(screen.getByRole('radio', { name: '直接生成' }));
    fireEvent.click(screen.getByRole('button', { name: '创建任务' }));

    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1));
    expect(onCreate).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue('主讲人')).not.toBeNull();
  });

  it('主题生成在已有 PPT 旁直接创建新任务，不要求替换确认', async () => {
    const { onCreate } = renderDialog({ hasExistingPpt: true });

    fireEvent.click(screen.getByRole('button', { name: '创建任务' }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it('创建期间禁用操作，失败后展示错误并允许重试', async () => {
    let rejectCreate: ((reason?: unknown) => void) | undefined;
    const onCreate = vi.fn(
      () =>
        new Promise<Task>((_resolve, reject) => {
          rejectCreate = reject;
        })
    );
    renderDialog({ onCreate });

    fireEvent.click(screen.getByRole('button', { name: '创建任务' }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(
      (
        screen.getByRole('button', {
          name: '创建任务',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: '取消' }) as HTMLButtonElement)
        .disabled
    ).toBe(true);

    rejectCreate?.(new Error('供应商暂不可用'));
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('供应商暂不可用')
    );
    expect(
      (
        screen.getByRole('button', {
          name: '创建任务',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false);
  });

  it('只展示当前真实支持的单人和双人讲解模式', () => {
    renderDialog();

    expect(screen.getByRole('radio', { name: '单人讲解' })).not.toBeNull();
    expect(screen.getByRole('radio', { name: '双人对谈' })).not.toBeNull();
    expect(screen.queryByText('专用 PPT Agent')).toBeNull();
    expect(screen.queryByText('单数字人')).toBeNull();
    expect(screen.queryByText('双数字人')).toBeNull();
    expect(screen.queryByDisplayValue('alloy')).toBeNull();
    expect(screen.queryByDisplayValue('nova')).toBeNull();
  });

  it('没有真实视频模型来源时禁止创建', () => {
    const draft: PptExplainerDialogDraft = {
      source: 'current_ppt',
      topic: '',
      reviewMode: 'confirm',
      presenterMode: 'single_voice',
      speakers: [{ displayName: '主讲人' }],
    };

    expect(
      validatePptExplainerDialogDraft(draft, {
        sourceBoardId: 'board-1',
        textModel: 'text-1',
        videoModel: '',
        videoModelRef: null,
      })
    ).toBe('请选择当前可用的视频模型');
  });

  it('PPTX 来源仅校验格式，不设置文件大小上限', () => {
    const pptxFile = new File(['pptx'], 'deck.pptx', {
      type: 'application/octet-stream',
    });
    Object.defineProperty(pptxFile, 'size', {
      configurable: true,
      value: 20 * 1024 * 1024 + 1,
    });
    const draft: PptExplainerDialogDraft = {
      source: 'pptx',
      topic: '',
      reviewMode: 'confirm',
      presenterMode: 'single_voice',
      pptxFile,
      speakers: [{ displayName: '主讲人' }],
    };

    expect(pptxFile.size).toBe(20 * 1024 * 1024 + 1);

    expect(
      validatePptExplainerDialogDraft(draft, {
        sourceBoardId: 'board-1',
        textModel: 'text-1',
        videoModel: 'video-1',
        videoModelRef,
      })
    ).toBeNull();

    draft.pptxFile = new File(['legacy'], 'deck.ppt');
    expect(
      validatePptExplainerDialogDraft(draft, {
        sourceBoardId: 'board-1',
        textModel: 'text-1',
        videoModel: 'video-1',
        videoModelRef,
      })
    ).toBe('仅支持 .pptx 文件');
  });
});
