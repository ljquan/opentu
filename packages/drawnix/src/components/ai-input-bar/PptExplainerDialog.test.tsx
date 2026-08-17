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

function selectVoiceIdSource(index = 0): void {
  fireEvent.click(
    screen.getAllByRole('radio', { name: '已有 voice ID' })[index]
  );
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

    selectVoiceIdSource();
    fireEvent.change(screen.getByPlaceholderText('输入供应商声音 ID'), {
      target: { value: 'voice-host' },
    });
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
        executionMode: 'local',
        presenterMode: 'single_voice',
        speakers: [
          expect.objectContaining({
            id: 'host',
            displayName: '主讲人',
            voiceId: 'voice-host',
          }),
        ],
      })
    );
    expect(mocks.success).toHaveBeenCalledWith('PPT 讲解任务已创建');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('取消跳过警告时不创建且配置保持可编辑', async () => {
    mocks.confirm.mockResolvedValue(false);
    const { onCreate, onClose } = renderDialog();

    selectVoiceIdSource();
    const voiceInput = screen.getByPlaceholderText('输入供应商声音 ID');
    fireEvent.change(voiceInput, { target: { value: 'voice-host' } });
    fireEvent.click(screen.getByRole('radio', { name: '直接生成' }));
    fireEvent.click(screen.getByRole('button', { name: '创建任务' }));

    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1));
    expect(onCreate).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(
      (screen.getByDisplayValue('voice-host') as HTMLInputElement).disabled
    ).toBe(false);
  });

  it('主题生成替换已有 PPT 前必须明确确认', async () => {
    mocks.confirm.mockResolvedValue(false);
    const { onCreate } = renderDialog({ hasExistingPpt: true });

    selectVoiceIdSource();
    fireEvent.change(screen.getByPlaceholderText('输入供应商声音 ID'), {
      target: { value: 'voice-host' },
    });
    fireEvent.click(screen.getByRole('button', { name: '创建任务' }));

    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1));
    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '替换当前 PPT？',
        confirmText: '确认替换',
      })
    );
    expect(onCreate).not.toHaveBeenCalled();
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

    selectVoiceIdSource();
    fireEvent.change(screen.getByPlaceholderText('输入供应商声音 ID'), {
      target: { value: 'voice-host' },
    });
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

  it('双数字人要求两套不同声线和数字人配置', () => {
    const draft: PptExplainerDialogDraft = {
      source: 'current_ppt',
      topic: '',
      reviewMode: 'confirm',
      presenterMode: 'dual_avatar',
      speakers: [
        {
          displayName: '主持人',
          voiceId: 'voice-a',
          avatarChoice: 'avatar-a',
        },
        {
          displayName: '嘉宾',
          voiceId: 'voice-a',
          avatarChoice: '',
        },
      ],
    };

    expect(
      validatePptExplainerDialogDraft(draft, {
        sourceBoardId: 'board-1',
        textModel: 'text-1',
        videoModel: 'video-1',
        videoModelRef,
      })
    ).toBe('请选择讲解者 2 的数字人');

    draft.speakers[1].avatarChoice = 'avatar-b';
    expect(
      validatePptExplainerDialogDraft(draft, {
        sourceBoardId: 'board-1',
        textModel: 'text-1',
        videoModel: 'video-1',
        videoModelRef,
      })
    ).toBe('双人模式需要两个不同的声音');

    draft.speakers[1].voiceId = 'voice-b';
    expect(
      validatePptExplainerDialogDraft(draft, {
        sourceBoardId: 'board-1',
        textModel: 'text-1',
        videoModel: 'video-1',
        videoModelRef,
      })
    ).toBeNull();
  });

  it('双数字人的声线和素材选择器使用独立布局容器', () => {
    renderDialog();

    fireEvent.click(screen.getByRole('radio', { name: '双数字人' }));
    selectVoiceIdSource(0);
    selectVoiceIdSource(1);

    const voiceInputs = screen.getAllByPlaceholderText('输入供应商声音 ID');
    expect(voiceInputs).toHaveLength(2);
    for (const input of voiceInputs) {
      expect(input.closest('.ppt-explainer-dialog__voice')).not.toBeNull();
    }
    expect(screen.getAllByRole('radio', { name: '参考音频' })).toHaveLength(2);

    const avatarInputs = screen.getAllByPlaceholderText(
      '选择数字人素材或输入 ID / URL'
    );
    expect(avatarInputs).toHaveLength(2);
    for (const input of avatarInputs) {
      expect(input.closest('.ppt-explainer-dialog__avatar')).not.toBeNull();
    }
  });

  it('只展示供应商可访问的数字人素材并拒绝失效素材', () => {
    const avatarAssets = [
      {
        id: 'local-avatar',
        type: 'IMAGE',
        source: 'LOCAL',
        url: '/__aitu_cache__/image/avatar.png',
        name: '本地数字人',
        mimeType: 'image/png',
        createdAt: 1,
      },
      {
        id: 'public-avatar',
        type: 'IMAGE',
        source: 'AI_GENERATED',
        url: 'https://cdn.example.com/avatar.png',
        name: '公开数字人',
        mimeType: 'image/png',
        createdAt: 2,
      },
    ] as React.ComponentProps<typeof PptExplainerDialog>['avatarAssets'];
    renderDialog({ avatarAssets });

    fireEvent.click(screen.getByRole('radio', { name: '单数字人' }));
    expect(screen.queryByText('本地数字人')).toBeNull();
    expect(screen.queryByText('公开数字人')).not.toBeNull();

    const draft: PptExplainerDialogDraft = {
      source: 'current_ppt',
      topic: '',
      reviewMode: 'confirm',
      presenterMode: 'single_avatar',
      speakers: [
        {
          displayName: '主讲人',
          voiceId: 'voice-a',
          avatarChoice: 'asset:local-avatar',
        },
      ],
    };
    expect(
      validatePptExplainerDialogDraft(draft, {
        sourceBoardId: 'board-1',
        textModel: 'text-1',
        videoModel: 'video-1',
        videoModelRef,
        avatarAssets,
      })
    ).toBe('讲解者 1 的数字人素材无法供供应商访问');

    draft.speakers[0].avatarChoice = '/asset-library/avatar.png';
    expect(
      validatePptExplainerDialogDraft(draft, {
        sourceBoardId: 'board-1',
        textModel: 'text-1',
        videoModel: 'video-1',
        videoModelRef,
        avatarAssets,
      })
    ).toBe('讲解者 1 的数字人必须使用供应商 ID 或公开 HTTP(S) URL');
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
      speakers: [
        {
          displayName: '主讲人',
          voiceId: 'voice-a',
          avatarChoice: '',
        },
      ],
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

  it('参考音频需要本人授权，授权后作为克隆样本创建任务', async () => {
    const { onCreate, container } = renderDialog();
    fireEvent.click(screen.getByRole('radio', { name: '专用 PPT Agent' }));
    fireEvent.click(screen.getByRole('radio', { name: '参考音频' }));
    const audioInput = container.querySelector(
      'input[type="file"][accept^="audio/"]'
    ) as HTMLInputElement;
    const sample = new File(['voice'], 'host.mp3', {
      type: 'audio/mpeg',
    });

    fireEvent.change(audioInput, { target: { files: [sample] } });

    expect(screen.getByText('host.mp3')).not.toBeNull();
    expect(screen.getByText('请确认已获得声音本人授权')).not.toBeNull();
    expect(
      (screen.getByRole('button', { name: '创建任务' }) as HTMLButtonElement)
        .disabled
    ).toBe(true);

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: '创建任务' }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        speakers: [
          expect.objectContaining({
            id: 'host',
            voiceSource: 'reference_audio',
            referenceAudio: expect.objectContaining({
              file: sample,
              filename: 'host.mp3',
              mimeType: 'audio/mpeg',
            }),
          }),
        ],
      })
    );
  });

  it('可以从素材库选择音频作为参考样本', async () => {
    const { onCreate } = renderDialog();

    fireEvent.click(screen.getByRole('radio', { name: '专用 PPT Agent' }));
    fireEvent.click(screen.getByRole('radio', { name: '参考音频' }));
    fireEvent.click(screen.getByRole('button', { name: '从素材库选择' }));
    fireEvent.click(screen.getByRole('button', { name: '选择测试音频' }));
    expect(screen.getByText('素材库样本.mp3')).not.toBeNull();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: '创建任务' }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        speakers: [
          expect.objectContaining({
            referenceAudio: expect.objectContaining({
              sourceAssetId: 'audio-asset-1',
              sourceUrl: '/__aitu_cache__/audio/sample.mp3',
            }),
          }),
        ],
      })
    );
  });
});
