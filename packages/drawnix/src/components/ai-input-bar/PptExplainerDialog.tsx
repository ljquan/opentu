import React, { useRef, useState } from 'react';
import { Button, Dialog, Input, MessagePlugin, Textarea } from 'tdesign-react';
import { FileUp, Trash2 } from 'lucide-react';
import type { ModelRef } from '../../utils/settings-manager';
import type { Task } from '../../types/task.types';
import type {
  PptExplainerCreateInput,
  PptExplainerCreateSpeakerInput,
  PptExplainerReviewMode,
  PptExplainerSourceKind,
} from '../../services/ppt-explainer/types';
import { authorizePptExplainerUiCreation } from '../../services/ppt-explainer/creation-service';
import { useConfirmDialog } from '../dialog/ConfirmDialog';
import './ppt-explainer-dialog.scss';

const SOURCE_OPTIONS: Array<{
  value: PptExplainerSourceKind;
  label: string;
}> = [
  { value: 'topic', label: '主题生成' },
  { value: 'current_ppt', label: '当前 PPT' },
  { value: 'pptx', label: '上传 PPTX' },
];

const PRESENTER_OPTIONS: Array<{
  value: PptExplainerCreateInput['presenterMode'];
  label: string;
}> = [
  { value: 'single_voice', label: '单人讲解' },
  { value: 'dual_voice', label: '双人对谈' },
];

interface SpeakerDraft {
  displayName: string;
}

export interface PptExplainerDialogDraft {
  source: PptExplainerSourceKind;
  topic: string;
  pptxFile?: File;
  reviewMode: PptExplainerReviewMode;
  presenterMode: PptExplainerCreateInput['presenterMode'];
  speakers: SpeakerDraft[];
}

export interface PptExplainerDialogProps {
  open: boolean;
  sourceBoardId?: string | null;
  hasExistingPpt: boolean;
  initialTopic?: string;
  textModel: string;
  textModelRef?: ModelRef | null;
  imageModel?: string;
  imageModelRef?: ModelRef | null;
  videoModel: string;
  videoModelRef?: ModelRef | null;
  onCreate: (input: PptExplainerCreateInput) => Promise<Task>;
  onClose: () => void;
}

function getSpeakerCount(
  mode: PptExplainerCreateInput['presenterMode']
): number {
  return mode === 'dual_voice' ? 2 : 1;
}

function createInitialDraft(initialTopic?: string): PptExplainerDialogDraft {
  const topic = initialTopic?.trim() || '';
  return {
    source: topic ? 'topic' : 'current_ppt',
    topic,
    reviewMode: 'confirm',
    presenterMode: 'single_voice',
    speakers: [{ displayName: '主讲人' }, { displayName: '嘉宾' }],
  };
}

function isPptxFile(file: File): boolean {
  return /\.pptx$/i.test(file.name);
}

export function validatePptExplainerDialogDraft(
  draft: PptExplainerDialogDraft,
  context: {
    sourceBoardId?: string | null;
    textModel: string;
    imageModel?: string;
    videoModel: string;
    videoModelRef?: ModelRef | null;
  }
): string | null {
  if (!context.sourceBoardId?.trim()) return '当前画板尚未就绪';
  if (!context.textModel.trim()) return '请选择文本模型';
  if (draft.source === 'topic' && !context.imageModel?.trim()) {
    return '请选择 PPT 页面图片模型';
  }
  if (!context.videoModel.trim() || !context.videoModelRef) {
    return '请选择当前可用的视频模型';
  }
  if (
    draft.presenterMode !== 'single_voice' &&
    draft.presenterMode !== 'dual_voice'
  ) {
    return '当前仅支持单人讲解和双人对谈';
  }
  if (draft.source === 'topic' && !draft.topic.trim()) return '请输入 PPT 主题';
  if (draft.source === 'pptx' && !draft.pptxFile) return '请选择 PPTX 文件';
  if (
    draft.source === 'pptx' &&
    draft.pptxFile &&
    !isPptxFile(draft.pptxFile)
  ) {
    return '仅支持 .pptx 文件';
  }

  const activeSpeakers = draft.speakers.slice(
    0,
    getSpeakerCount(draft.presenterMode)
  );
  if (activeSpeakers.length !== getSpeakerCount(draft.presenterMode)) {
    return '讲解者配置不完整';
  }
  for (const [index, speaker] of activeSpeakers.entries()) {
    if (!speaker.displayName.trim()) return `请填写讲解者 ${index + 1} 的名称`;
  }
  return null;
}

function SegmentControl<T extends string>({
  label,
  options,
  value,
  disabled,
  onChange,
}: {
  label: string;
  options: Array<{ value: T; label: string }>;
  value: T;
  disabled: boolean;
  onChange: (value: T) => void;
}) {
  return (
    <div
      className="ppt-explainer-dialog__segments"
      role="radiogroup"
      aria-label={label}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          className="ppt-explainer-dialog__segment"
          data-active={value === option.value || undefined}
          disabled={disabled}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export const PptExplainerDialog: React.FC<PptExplainerDialogProps> = ({
  open,
  sourceBoardId,
  initialTopic,
  textModel,
  textModelRef,
  imageModel,
  imageModelRef,
  videoModel,
  videoModelRef,
  onCreate,
  onClose,
}) => {
  const [draft, setDraft] = useState(() => createInitialDraft(initialTopic));
  const [loading, setLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { confirm, confirmDialog } = useConfirmDialog();
  const speakerCount = getSpeakerCount(draft.presenterMode);
  const validationError = validatePptExplainerDialogDraft(draft, {
    sourceBoardId,
    textModel,
    imageModel,
    videoModel,
    videoModelRef,
  });

  const updateSpeaker = (index: number, patch: Partial<SpeakerDraft>): void => {
    setSubmitError(null);
    setDraft((current) => ({
      ...current,
      speakers: current.speakers.map((speaker, speakerIndex) =>
        speakerIndex === index ? { ...speaker, ...patch } : speaker
      ),
    }));
  };

  const handleSubmit = async (): Promise<void> => {
    if (loading || validationError || !sourceBoardId) return;

    let skipOutlineReview = false;
    if (draft.source === 'topic' && draft.reviewMode === 'skip_after_warning') {
      skipOutlineReview = await confirm({
        title: '跳过大纲确认？',
        description:
          '确认后将直接生成 PPT 页面、讲稿和讲解视频，不再停留等待大纲审核。',
        confirmText: '确认直接生成',
        confirmTheme: 'warning',
      });
      if (!skipOutlineReview) return;
    }

    setLoading(true);
    setSubmitError(null);
    try {
      const speakers: PptExplainerCreateSpeakerInput[] = draft.speakers
        .slice(0, speakerCount)
        .map((speaker, index) => ({
          id: index === 0 ? 'host' : 'guest',
          displayName: speaker.displayName.trim(),
        }));
      const input: PptExplainerCreateInput = {
        source: draft.source,
        sourceBoardId,
        ...(draft.source === 'topic' ? { topic: draft.topic.trim() } : {}),
        reviewMode: draft.source === 'topic' ? draft.reviewMode : 'confirm',
        presenterMode: draft.presenterMode,
        speakers,
        textModel,
        textModelRef,
        imageModel,
        imageModelRef,
        videoModel,
        videoModelRef,
        ...(draft.source === 'pptx' && draft.pptxFile
          ? { pptxFile: draft.pptxFile }
          : {}),
      };
      if (skipOutlineReview) {
        authorizePptExplainerUiCreation(input, {
          skipOutlineReview,
        });
      }
      await onCreate(input);
      MessagePlugin.success('PPT 讲解任务已创建');
      onClose();
    } catch (error) {
      setSubmitError(
        error instanceof Error ? error.message : 'PPT 讲解任务创建失败'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Dialog
        visible={open}
        header="生成 PPT 讲解视频"
        width={640}
        destroyOnClose
        closeOnOverlayClick={!loading}
        closeOnEscKeydown={!loading}
        onClose={() => {
          if (!loading) onClose();
        }}
        footer={
          <div className="ppt-explainer-dialog__footer">
            <span
              className="ppt-explainer-dialog__footer-status"
              role={submitError ? 'alert' : undefined}
            >
              {submitError || validationError || ''}
            </span>
            <Button variant="outline" disabled={loading} onClick={onClose}>
              取消
            </Button>
            <Button
              theme="primary"
              loading={loading}
              disabled={loading || Boolean(validationError)}
              onClick={() => void handleSubmit()}
            >
              创建任务
            </Button>
          </div>
        }
      >
        <div className="ppt-explainer-dialog__form">
          <section className="ppt-explainer-dialog__section">
            <label className="ppt-explainer-dialog__label">演示来源</label>
            <SegmentControl
              label="演示来源"
              options={SOURCE_OPTIONS}
              value={draft.source}
              disabled={loading}
              onChange={(source) => {
                setSubmitError(null);
                setDraft((current) => ({ ...current, source }));
              }}
            />
            {draft.source === 'topic' ? (
              <Textarea
                value={draft.topic}
                placeholder="输入 PPT 主题"
                autosize={{ minRows: 2, maxRows: 4 }}
                disabled={loading}
                onChange={(topic) => {
                  setSubmitError(null);
                  setDraft((current) => ({ ...current, topic }));
                }}
              />
            ) : null}
            {draft.source === 'pptx' ? (
              <div className="ppt-explainer-dialog__file-row">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
                  hidden
                  disabled={loading}
                  onChange={(event) => {
                    const pptxFile = event.target.files?.[0];
                    setSubmitError(null);
                    setDraft((current) => ({ ...current, pptxFile }));
                  }}
                />
                <Button
                  variant="outline"
                  icon={<FileUp size={16} />}
                  disabled={loading}
                  onClick={() => fileInputRef.current?.click()}
                >
                  选择 PPTX
                </Button>
                <span className="ppt-explainer-dialog__file-name">
                  {draft.pptxFile?.name || '未选择文件'}
                </span>
                {draft.pptxFile ? (
                  <Button
                    variant="text"
                    shape="square"
                    icon={<Trash2 size={15} />}
                    aria-label="移除 PPTX"
                    disabled={loading}
                    onClick={() => {
                      if (fileInputRef.current) fileInputRef.current.value = '';
                      setDraft((current) => ({
                        ...current,
                        pptxFile: undefined,
                      }));
                    }}
                  />
                ) : null}
              </div>
            ) : null}
          </section>

          {draft.source === 'topic' ? (
            <section className="ppt-explainer-dialog__section">
              <label className="ppt-explainer-dialog__label">大纲审核</label>
              <SegmentControl
                label="大纲审核"
                options={[
                  { value: 'confirm', label: '确认大纲' },
                  { value: 'skip_after_warning', label: '直接生成' },
                ]}
                value={draft.reviewMode}
                disabled={loading}
                onChange={(reviewMode) => {
                  setSubmitError(null);
                  setDraft((current) => ({ ...current, reviewMode }));
                }}
              />
            </section>
          ) : null}

          <section className="ppt-explainer-dialog__section">
            <label className="ppt-explainer-dialog__label">讲解模式</label>
            <SegmentControl
              label="讲解模式"
              options={PRESENTER_OPTIONS}
              value={draft.presenterMode}
              disabled={loading}
              onChange={(presenterMode) => {
                setSubmitError(null);
                setDraft((current) => ({
                  ...current,
                  presenterMode,
                }));
              }}
            />
          </section>

          <section className="ppt-explainer-dialog__section">
            <label className="ppt-explainer-dialog__label">讲解者</label>
            <div className="ppt-explainer-dialog__speakers">
              {draft.speakers.slice(0, speakerCount).map((speaker, index) => (
                <div className="ppt-explainer-dialog__speaker" key={index}>
                  <span className="ppt-explainer-dialog__speaker-index">
                    {index + 1}
                  </span>
                  <Input
                    value={speaker.displayName}
                    placeholder={`讲解者 ${index + 1}`}
                    aria-label={`讲解者 ${index + 1} 名称`}
                    disabled={loading}
                    onChange={(displayName) =>
                      updateSpeaker(index, { displayName })
                    }
                  />
                </div>
              ))}
            </div>
            <div className="ppt-explainer-dialog__hint" role="note">
              将逐页使用当前选择的视频模型生成讲解音轨，再固定原 PPT
              页面合成。朗读内容、音色和时长由所选模型的实际能力决定。
            </div>
          </section>
        </div>
      </Dialog>
      {confirmDialog}
    </>
  );
};
