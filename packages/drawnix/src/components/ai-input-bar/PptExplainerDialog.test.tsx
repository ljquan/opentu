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
import { ModelVendor, type ModelConfig } from '../../constants/model-config';
import type { ModelRef } from '../../utils/settings-manager';
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

vi.mock('./ModelDropdown', () => ({
  ModelDropdown: ({
    models,
    selectedModel,
    onSelect,
    placeholder,
  }: {
    models: ModelConfig[];
    selectedModel: string;
    onSelect: (
      modelId: string,
      modelRef?: { profileId: string | null; modelId: string } | null
    ) => void;
    placeholder?: string;
  }) => (
    <div>
      <span>{models.length ? selectedModel : placeholder}</span>
      {models.map((model) => (
        <button
          type="button"
          key={model.selectionKey || model.id}
          aria-label={`选择 ${model.label || model.id}`}
          onClick={() =>
            onSelect(model.id, {
              profileId: model.sourceProfileId || null,
              modelId: model.id,
            })
          }
        >
          {model.label || model.id}
        </button>
      ))}
    </div>
  ),
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
  InputNumber: ({
    value,
    disabled,
    onChange,
  }: {
    value?: number;
    disabled?: boolean;
    onChange?: (value: number) => void;
  }) => (
    <input
      type="number"
      aria-label="每页讲解时长"
      value={value ?? ''}
      disabled={disabled}
      onChange={(event) => onChange?.(Number(event.target.value))}
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
  MessagePlugin: {
    success: mocks.success,
  },
}));

const videoModelRef = { profileId: 'profile-1', modelId: 'video-1' };

function createVideoModel(
  id: string,
  label: string,
  profileId: string
): ModelConfig {
  return {
    id,
    label,
    type: 'video',
    vendor: ModelVendor.OTHER,
    sourceProfileId: profileId,
    selectionKey: `${profileId}::${id}`,
  };
}

const videoModels = [
  createVideoModel('video-1', '视频模型 1', 'profile-1'),
  createVideoModel('video-2', '视频模型 2', 'profile-2'),
];

function renderDialog(
  overrides: Partial<React.ComponentProps<typeof PptExplainerDialog>> = {}
) {
  const onCreate =
    overrides.onCreate || vi.fn().mockResolvedValue({ id: 'task-1' } as Task);
  const onClose = vi.fn();
  const onVideoModelChange =
    overrides.onVideoModelChange ||
    vi.fn<(modelId: string, modelRef?: ModelRef | null) => void>();
  const rendered = render(
    <PptExplainerDialog
      open
      sourceBoardId="board-1"
      initialTopic="季度复盘"
      textModel="text-1"
      imageModel="image-1"
      videoModel="video-1"
      videoModelRef={videoModelRef}
      videoModels={videoModels}
      onVideoModelChange={onVideoModelChange}
      onCreate={onCreate}
      onClose={onClose}
      {...overrides}
    />
  );
  return { onCreate, onClose, onVideoModelChange, ...rendered };
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

  it('主题生成直接创建新任务，不要求替换确认', async () => {
    const { onCreate } = renderDialog();

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

    expect(screen.getByRole('radio', { name: '主题生成' })).not.toBeNull();
    expect(screen.getByRole('radio', { name: '当前 PPT' })).not.toBeNull();
    expect(screen.queryByText('上传 PPTX')).toBeNull();
    expect(screen.getByRole('radio', { name: '单人讲解' })).not.toBeNull();
    expect(screen.getByRole('radio', { name: '双人对谈' })).not.toBeNull();
    expect(screen.queryByText('专用 PPT Agent')).toBeNull();
    expect(screen.queryByText('单数字人')).toBeNull();
    expect(screen.queryByText('双数字人')).toBeNull();
    expect(screen.queryByDisplayValue('alloy')).toBeNull();
    expect(screen.queryByDisplayValue('nova')).toBeNull();
  });

  it('双人模式明确提示视频模型不提供固定声线身份', () => {
    renderDialog();

    fireEvent.click(screen.getByRole('radio', { name: '双人对谈' }));

    expect(screen.getByText(/普通视频模型不提供固定 voice ID/)).not.toBeNull();
  });

  it('没有真实视频模型来源时禁止创建', () => {
    const draft: PptExplainerDialogDraft = {
      source: 'current_ppt',
      topic: '',
      reviewMode: 'confirm',
      presenterMode: 'single_voice',
      secondsPerSlide: 10,
      narrationInstruction: '',
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

  it('在弹窗底部切换真实视频模型并回写对应来源', () => {
    const { onVideoModelChange } = renderDialog();

    fireEvent.click(screen.getByRole('button', { name: '选择 视频模型 2' }));

    expect(onVideoModelChange).toHaveBeenCalledWith('video-2', {
      profileId: 'profile-2',
      modelId: 'video-2',
    });
  });

  it('切换同名视频模型时保留供应商来源', () => {
    const sameIdModels = [
      createVideoModel('shared-video', '供应商 A', 'profile-a'),
      createVideoModel('shared-video', '供应商 B', 'profile-b'),
    ];
    const { onVideoModelChange } = renderDialog({
      videoModel: 'shared-video',
      videoModelRef: { profileId: 'profile-a', modelId: 'shared-video' },
      videoModels: sameIdModels,
    });

    fireEvent.click(screen.getByRole('button', { name: '选择 供应商 B' }));

    expect(onVideoModelChange).toHaveBeenCalledWith('shared-video', {
      profileId: 'profile-b',
      modelId: 'shared-video',
    });
  });

  it('没有已配置视频模型时显示空态并禁止创建', () => {
    renderDialog({ videoModels: [] });

    expect(screen.getByText('暂无已配置视频模型')).not.toBeNull();
    expect(
      (screen.getByRole('button', { name: '创建任务' }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
  });

  it('当前模型已不在候选列表时禁止创建', () => {
    renderDialog({
      videoModel: 'removed-video',
      videoModelRef: {
        profileId: 'removed-profile',
        modelId: 'removed-video',
      },
    });

    expect(
      (screen.getByRole('button', { name: '创建任务' }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
  });

  it('从 PPT 编辑器入口打开时直接使用当前 PPT', () => {
    renderDialog({
      initialTopic: '输入框残留主题',
      initialSource: 'current_ppt',
    });

    expect(
      screen
        .getByRole('radio', { name: '当前 PPT' })
        .getAttribute('aria-checked')
    ).toBe('true');
    expect(screen.queryByPlaceholderText('输入 PPT 主题')).toBeNull();
  });

  it('从提示词识别每页秒数并保留讲解要求', async () => {
    const { onCreate } = renderDialog({
      initialTopic: '每页 30 秒，语速自然，重点解释图表',
      initialSource: 'current_ppt',
    });

    expect(
      (screen.getByLabelText('每页讲解时长') as HTMLInputElement).value
    ).toBe('30');
    fireEvent.click(screen.getByRole('button', { name: '创建任务' }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate.mock.calls[0][0]).toMatchObject({
      secondsPerSlide: 30,
      narrationInstruction: '每页 30 秒，语速自然，重点解释图表',
    });
  });

  it('从 PPT 编辑器入口打开时仅提交已选页面', async () => {
    const { onCreate } = renderDialog({
      initialSource: 'current_ppt',
      currentPptFrameIds: ['frame-1', 'frame-3'],
    });

    expect(screen.getByText(/将仅生成已选 2 页/)).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '创建任务' }));

    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate.mock.calls[0][0]).toMatchObject({
      source: 'current_ppt',
      currentPptFrameIds: ['frame-1', 'frame-3'],
    });
  });
});
