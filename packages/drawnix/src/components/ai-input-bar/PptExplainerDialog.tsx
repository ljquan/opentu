import React, { useState } from 'react';
import {
  Button,
  Dialog,
  Input,
  InputNumber,
  MessagePlugin,
  Textarea,
} from 'tdesign-react';
import type { ModelRef } from '../../utils/settings-manager';
import type { Task } from '../../types/task.types';
import type {
  PptExplainerCreateInput,
  PptExplainerCreateSourceKind,
  PptExplainerCreateSpeakerInput,
  PptExplainerReviewMode,
} from '../../services/ppt-explainer/types';
import { authorizePptExplainerUiCreation } from '../../services/ppt-explainer/creation-service';
import { useConfirmDialog } from '../dialog/ConfirmDialog';
import './ppt-explainer-dialog.scss';

const SOURCE_OPTIONS: Array<{
  value: PptExplainerCreateSourceKind;
  label: string;
}> = [
  { value: 'topic', label: '主题生成' },
  { value: 'current_ppt', label: '当前 PPT' },
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
  source: PptExplainerCreateSourceKind;
  topic: string;
  reviewMode: PptExplainerReviewMode;
  presenterMode: PptExplainerCreateInput['presenterMode'];
  secondsPerSlide: number;
  narrationInstruction: string;
  speakers: SpeakerDraft[];
}

export interface PptExplainerDialogProps {
  open: boolean;
  sourceBoardId?: string | null;
  initialTopic?: string;
  initialSource?: PptExplainerCreateSourceKind;
  currentPptFrameIds?: string[];
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

function createInitialDraft(
  initialTopic?: string,
  initialSource?: PptExplainerCreateSourceKind
): PptExplainerDialogDraft {
  const topic = initialTopic?.trim() || '';
  const secondsMatch = topic.match(
    /(?:每|单)(?:一)?(?:页|张)\s*(?:PPT)?\s*(?:讲解|播放|时长|控制在|约为|为)?\s*(\d{1,6})\s*秒/i
  );
  const parsedSeconds = secondsMatch ? Number(secondsMatch[1]) : 10;
  return {
    source: initialSource || (topic ? 'topic' : 'current_ppt'),
    topic,
    reviewMode: 'confirm',
    presenterMode: 'single_voice',
    secondsPerSlide:
      Number.isSafeInteger(parsedSeconds) && parsedSeconds > 0
        ? parsedSeconds
        : 10,
    narrationInstruction: topic,
    speakers: [{ displayName: '主讲人' }, { displayName: '嘉宾' }],
  };
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
  if (
    !Number.isSafeInteger(draft.secondsPerSlide) ||
    draft.secondsPerSlide <= 0
  ) {
    return '每页讲解时长必须是正整数秒';
  }
  if (draft.source === 'topic' && !draft.topic.trim()) return '请输入 PPT 主题';

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
  initialSource,
  currentPptFrameIds,
  textModel,
  textModelRef,
  imageModel,
  imageModelRef,
  videoModel,
  videoModelRef,
  onCreate,
  onClose,
}) => {
  const [draft, setDraft] = useState(() =>
    createInitialDraft(initialTopic, initialSource)
  );
  const [loading, setLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
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
        ...(draft.source === 'current_ppt' && currentPptFrameIds?.length
          ? { currentPptFrameIds: [...currentPptFrameIds] }
          : {}),
        ...(draft.source === 'topic' ? { topic: draft.topic.trim() } : {}),
        reviewMode: draft.source === 'topic' ? draft.reviewMode : 'confirm',
        presenterMode: draft.presenterMode,
        secondsPerSlide: draft.secondsPerSlide,
        narrationInstruction: draft.narrationInstruction.trim() || undefined,
        speakers,
        textModel,
        textModelRef,
        imageModel,
        imageModelRef,
        videoModel,
        videoModelRef,
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
            {draft.source === 'current_ppt' && currentPptFrameIds?.length ? (
              <div className="ppt-explainer-dialog__hint" role="note">
                将仅生成已选 {currentPptFrameIds.length} 页，顺序按当前 PPT
                页码排列。
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
            {draft.presenterMode === 'dual_voice' ? (
              <div className="ppt-explainer-dialog__hint" role="note">
                双人会按角色分别请求视频模型，并加入主讲人男声、嘉宾女声约束；实际音色由所选模型决定，普通视频模型不提供固定
                voice ID。
              </div>
            ) : null}
          </section>

          <section className="ppt-explainer-dialog__section">
            <label className="ppt-explainer-dialog__label">每页讲解时长</label>
            <div className="ppt-explainer-dialog__duration-row">
              <InputNumber
                value={draft.secondsPerSlide}
                min={1}
                step={1}
                decimalPlaces={0}
                disabled={loading}
                onChange={(value) => {
                  setSubmitError(null);
                  setDraft((current) => ({
                    ...current,
                    secondsPerSlide: Number(value),
                  }));
                }}
              />
              <span>秒</span>
            </div>
          </section>

          <section className="ppt-explainer-dialog__section">
            <label className="ppt-explainer-dialog__label">讲解要求</label>
            <Textarea
              value={draft.narrationInstruction}
              placeholder="例如：每页 10 秒，语速自然，重点解释图表结论"
              autosize={{ minRows: 2, maxRows: 4 }}
              disabled={loading}
              onChange={(narrationInstruction) => {
                setSubmitError(null);
                setDraft((current) => ({
                  ...current,
                  narrationInstruction,
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
              页面合成。系统会按模型支持时长自动分段；媒体无法解码或音轨不可播放时会明确报错，片段提前结束则按实际时长合成。
            </div>
          </section>
        </div>
      </Dialog>
      {confirmDialog}
    </>
  );
};
