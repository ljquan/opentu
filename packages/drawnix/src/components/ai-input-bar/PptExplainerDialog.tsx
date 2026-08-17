import React, { useMemo, useRef, useState } from 'react';
import {
  Button,
  Checkbox,
  Dialog,
  Input,
  MessagePlugin,
  Select,
  Textarea,
} from 'tdesign-react';
import { FileAudio, FileUp, Library, Trash2 } from 'lucide-react';
import type { ModelRef } from '../../utils/settings-manager';
import type { Asset } from '../../types/asset.types';
import { AssetType, SelectionMode } from '../../types/asset.types';
import type { Task } from '../../types/task.types';
import type {
  PptExplainerCreateInput,
  PptExplainerPresenterMode,
  PptExplainerReviewMode,
  PptExplainerReferenceAudioInput,
  PptExplainerSourceKind,
  PptExplainerSpeakerInput,
  PptExplainerVoiceSource,
} from '../../services/ppt-explainer/types';
import { authorizePptExplainerUiCreation } from '../../services/ppt-explainer/creation-service';
import {
  inferPptExplainerAudioMimeType,
  isProviderReachableAvatarUrl,
} from '../../services/ppt-explainer/validation';
import { useConfirmDialog } from '../dialog/ConfirmDialog';
import { MediaLibraryModal } from '../media-library/MediaLibraryModal';
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
  value: PptExplainerPresenterMode;
  label: string;
}> = [
  { value: 'single_voice', label: '单声线' },
  { value: 'dual_voice', label: '双声线' },
  { value: 'single_avatar', label: '单数字人' },
  { value: 'dual_avatar', label: '双数字人' },
];

interface SpeakerDraft {
  displayName: string;
  voiceSource?: PptExplainerVoiceSource;
  voiceId: string;
  referenceAudio?: PptExplainerReferenceAudioInput;
  avatarChoice: string;
}

export interface PptExplainerDialogDraft {
  source: PptExplainerSourceKind;
  topic: string;
  pptxFile?: File;
  reviewMode: PptExplainerReviewMode;
  presenterMode: PptExplainerPresenterMode;
  speakers: SpeakerDraft[];
  voiceCloneConsent?: boolean;
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
  avatarAssets?: Asset[];
  onCreate: (input: PptExplainerCreateInput) => Promise<Task>;
  onClose: () => void;
}

function getSpeakerCount(mode: PptExplainerPresenterMode): number {
  return mode === 'dual_voice' || mode === 'dual_avatar' ? 2 : 1;
}

function needsAvatar(mode: PptExplainerPresenterMode): boolean {
  return mode === 'single_avatar' || mode === 'dual_avatar';
}

function createInitialDraft(initialTopic?: string): PptExplainerDialogDraft {
  const topic = initialTopic?.trim() || '';
  return {
    source: topic ? 'topic' : 'current_ppt',
    topic,
    reviewMode: 'confirm',
    presenterMode: 'single_voice',
    speakers: [
      {
        displayName: '主讲人',
        voiceSource: 'reference_audio',
        voiceId: '',
        avatarChoice: '',
      },
      {
        displayName: '嘉宾',
        voiceSource: 'reference_audio',
        voiceId: '',
        avatarChoice: '',
      },
    ],
    voiceCloneConsent: false,
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
    avatarAssets?: readonly Asset[];
  }
): string | null {
  if (!context.sourceBoardId?.trim()) return '当前画板尚未就绪';
  if (!context.textModel.trim()) return '请选择文本模型';
  if (draft.source === 'topic' && !context.imageModel?.trim()) {
    return '请选择 PPT 页面图片模型';
  }
  if (!context.videoModel.trim() || !context.videoModelRef) {
    return '请选择支持 PPT 讲解的供应商视频模型';
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
    const voiceSource =
      speaker.voiceSource ||
      (speaker.referenceAudio ? 'reference_audio' : 'voice_id');
    if (voiceSource === 'voice_id' && !speaker.voiceId.trim()) {
      return `请输入讲解者 ${index + 1} 的声音 ID`;
    }
    if (voiceSource === 'reference_audio') {
      if (!speaker.referenceAudio) {
        return `请选择讲解者 ${index + 1} 的参考音频`;
      }
      if (
        !inferPptExplainerAudioMimeType(
          speaker.referenceAudio.mimeType || speaker.referenceAudio.file?.type,
          speaker.referenceAudio.filename || speaker.referenceAudio.file?.name
        )
      ) {
        return `讲解者 ${index + 1} 的参考音频格式不受支持`;
      }
    }
    if (needsAvatar(draft.presenterMode) && !speaker.avatarChoice.trim()) {
      return `请选择讲解者 ${index + 1} 的数字人`;
    }
    const avatarChoice = speaker.avatarChoice.trim();
    if (needsAvatar(draft.presenterMode) && avatarChoice.startsWith('asset:')) {
      const assetId = avatarChoice.slice('asset:'.length);
      const asset = context.avatarAssets?.find(
        (item) =>
          item.id === assetId &&
          item.type === AssetType.IMAGE &&
          isProviderReachableAvatarUrl(item.url)
      );
      if (!asset) {
        return `讲解者 ${index + 1} 的数字人素材无法供供应商访问`;
      }
    }
    if (
      needsAvatar(draft.presenterMode) &&
      /^(?:https?:|data:|blob:|\/)/i.test(avatarChoice) &&
      !isProviderReachableAvatarUrl(avatarChoice)
    ) {
      return `讲解者 ${index + 1} 的数字人必须使用供应商 ID 或公开 HTTP(S) URL`;
    }
  }
  if (
    activeSpeakers.length === 2 &&
    activeSpeakers.every(
      (speaker) =>
        (speaker.voiceSource ||
          (speaker.referenceAudio ? 'reference_audio' : 'voice_id')) ===
        'voice_id'
    ) &&
    activeSpeakers[0].voiceId.trim() === activeSpeakers[1].voiceId.trim()
  ) {
    return '双人模式需要两个不同的声音';
  }
  if (
    activeSpeakers.some(
      (speaker) =>
        (speaker.voiceSource ||
          (speaker.referenceAudio ? 'reference_audio' : 'voice_id')) ===
        'reference_audio'
    ) &&
    !draft.voiceCloneConsent
  ) {
    return '请确认已获得声音本人授权';
  }
  return null;
}

function resolveAvatar(
  choice: string,
  avatarAssets: readonly Asset[]
): Pick<PptExplainerSpeakerInput, 'avatarAssetId' | 'avatarSourceUrl'> {
  const normalized = choice.trim();
  if (!normalized) return {};
  if (normalized.startsWith('asset:')) {
    const assetId = normalized.slice('asset:'.length);
    const asset = avatarAssets.find((item) => item.id === assetId);
    return asset ? { avatarSourceUrl: asset.url } : {};
  }
  if (/^(?:https?:|\/)/i.test(normalized)) {
    return { avatarSourceUrl: normalized };
  }
  return { avatarAssetId: normalized };
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
  hasExistingPpt,
  initialTopic,
  textModel,
  textModelRef,
  imageModel,
  imageModelRef,
  videoModel,
  videoModelRef,
  avatarAssets = [],
  onCreate,
  onClose,
}) => {
  const [draft, setDraft] = useState(() => createInitialDraft(initialTopic));
  const [loading, setLoading] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioInputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const [audioLibrarySpeakerIndex, setAudioLibrarySpeakerIndex] = useState<
    number | null
  >(null);
  const { confirm, confirmDialog } = useConfirmDialog();
  const speakerCount = getSpeakerCount(draft.presenterMode);
  const avatarMode = needsAvatar(draft.presenterMode);
  const activeSpeakers = draft.speakers.slice(0, speakerCount);
  const usesReferenceAudio = activeSpeakers.some(
    (speaker) =>
      (speaker.voiceSource ||
        (speaker.referenceAudio ? 'reference_audio' : 'voice_id')) ===
      'reference_audio'
  );
  const providerAvatarAssets = useMemo(
    () =>
      avatarAssets.filter(
        (asset) =>
          asset.type === AssetType.IMAGE &&
          isProviderReachableAvatarUrl(asset.url)
      ),
    [avatarAssets]
  );
  const avatarOptions = useMemo(
    () =>
      providerAvatarAssets.map((asset) => ({
        value: `asset:${asset.id}`,
        label: asset.name,
      })),
    [providerAvatarAssets]
  );
  const validationError = validatePptExplainerDialogDraft(draft, {
    sourceBoardId,
    textModel,
    imageModel,
    videoModel,
    videoModelRef,
    avatarAssets: providerAvatarAssets,
  });

  const updateSpeaker = (
    index: number,
    patch: Partial<SpeakerDraft>,
    resetVoiceConsent = false
  ): void => {
    setSubmitError(null);
    setDraft((current) => ({
      ...current,
      ...(resetVoiceConsent ? { voiceCloneConsent: false } : {}),
      speakers: current.speakers.map((speaker, speakerIndex) =>
        speakerIndex === index ? { ...speaker, ...patch } : speaker
      ),
    }));
  };

  const selectReferenceAudio = (
    index: number,
    referenceAudio: PptExplainerReferenceAudioInput
  ): void => {
    updateSpeaker(
      index,
      {
        voiceSource: 'reference_audio',
        voiceId: '',
        referenceAudio,
      },
      true
    );
  };

  const handleAudioAssetSelect = async (asset: Asset): Promise<void> => {
    const speakerIndex = audioLibrarySpeakerIndex;
    if (speakerIndex === null) return;
    if (asset.type !== AssetType.AUDIO) {
      setSubmitError('请选择音频素材');
      return;
    }
    const mimeType = inferPptExplainerAudioMimeType(asset.mimeType, asset.name);
    if (!mimeType) {
      setSubmitError('所选素材不是受支持的音频格式');
      return;
    }
    selectReferenceAudio(speakerIndex, {
      sourceAssetId: asset.id,
      sourceUrl: asset.url,
      filename: asset.name,
      mimeType,
      size: asset.size,
    });
    setAudioLibrarySpeakerIndex(null);
  };

  const handleSubmit = async (): Promise<void> => {
    if (loading || validationError || !videoModelRef || !sourceBoardId) return;

    let replaceExistingPpt = false;
    if (draft.source === 'topic' && hasExistingPpt) {
      replaceExistingPpt = await confirm({
        title: '替换当前 PPT？',
        description:
          '主题生成会删除画布中现有 PPT 页面及其内容，再创建新的 PPT。',
        confirmText: '确认替换',
        confirmTheme: 'warning',
      });
      if (!replaceExistingPpt) return;
    }

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
      const speakers: PptExplainerSpeakerInput[] = draft.speakers
        .slice(0, speakerCount)
        .map((speaker, index) => {
          const voiceSource =
            speaker.voiceSource ||
            (speaker.referenceAudio ? 'reference_audio' : 'voice_id');
          return {
            id: index === 0 ? 'host' : 'guest',
            displayName: speaker.displayName.trim(),
            voiceSource,
            ...(voiceSource === 'reference_audio'
              ? { referenceAudio: speaker.referenceAudio }
              : { voiceId: speaker.voiceId.trim() }),
            ...(avatarMode
              ? resolveAvatar(speaker.avatarChoice, providerAvatarAssets)
              : {}),
          };
        });
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
      if (skipOutlineReview || replaceExistingPpt || usesReferenceAudio) {
        authorizePptExplainerUiCreation(input, {
          skipOutlineReview,
          replaceExistingPpt,
          voiceCloneConsent:
            usesReferenceAudio && Boolean(draft.voiceCloneConsent),
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
                  voiceCloneConsent: false,
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
                  <div className="ppt-explainer-dialog__voice-source">
                    <SegmentControl
                      label={`讲解者 ${index + 1} 声音来源`}
                      options={[
                        { value: 'reference_audio', label: '参考音频' },
                        { value: 'voice_id', label: '已有 voice ID' },
                      ]}
                      value={
                        speaker.voiceSource ||
                        (speaker.referenceAudio
                          ? 'reference_audio'
                          : 'voice_id')
                      }
                      disabled={loading}
                      onChange={(voiceSource) =>
                        updateSpeaker(
                          index,
                          {
                            voiceSource,
                            voiceId:
                              voiceSource === 'voice_id' ? speaker.voiceId : '',
                            referenceAudio:
                              voiceSource === 'reference_audio'
                                ? speaker.referenceAudio
                                : undefined,
                          },
                          true
                        )
                      }
                    />
                  </div>
                  {(speaker.voiceSource ||
                    (speaker.referenceAudio
                      ? 'reference_audio'
                      : 'voice_id')) === 'voice_id' ? (
                    <div className="ppt-explainer-dialog__voice">
                      <Input
                        value={speaker.voiceId}
                        placeholder="输入供应商声音 ID"
                        aria-label={`讲解者 ${index + 1} 声音 ID`}
                        disabled={loading}
                        onChange={(voiceId) =>
                          updateSpeaker(index, {
                            voiceId,
                          })
                        }
                      />
                    </div>
                  ) : (
                    <div className="ppt-explainer-dialog__audio-sample">
                      <input
                        ref={(element) => {
                          audioInputRefs.current[index] = element;
                        }}
                        type="file"
                        accept="audio/*,.mp3,.wav,.m4a,.aac,.ogg,.oga,.webm,.flac"
                        hidden
                        disabled={loading}
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          event.currentTarget.value = '';
                          if (!file) return;
                          const mimeType = inferPptExplainerAudioMimeType(
                            file.type,
                            file.name
                          );
                          if (!file.size || !mimeType) {
                            setSubmitError(
                              file.size
                                ? '参考音频格式不受支持'
                                : '参考音频不能为空'
                            );
                            return;
                          }
                          selectReferenceAudio(index, {
                            file,
                            filename: file.name,
                            mimeType,
                            size: file.size,
                          });
                        }}
                      />
                      <Button
                        variant="outline"
                        icon={<FileAudio size={16} />}
                        disabled={loading}
                        onClick={() => audioInputRefs.current[index]?.click()}
                      >
                        上传音频
                      </Button>
                      <Button
                        variant="outline"
                        icon={<Library size={16} />}
                        disabled={loading}
                        onClick={() => setAudioLibrarySpeakerIndex(index)}
                      >
                        从素材库选择
                      </Button>
                      <span className="ppt-explainer-dialog__file-name">
                        {speaker.referenceAudio?.filename || '未选择音频'}
                      </span>
                      {speaker.referenceAudio ? (
                        <Button
                          variant="text"
                          shape="square"
                          icon={<Trash2 size={15} />}
                          aria-label={`移除讲解者 ${index + 1} 的参考音频`}
                          disabled={loading}
                          onClick={() =>
                            updateSpeaker(
                              index,
                              { referenceAudio: undefined },
                              true
                            )
                          }
                        />
                      ) : null}
                    </div>
                  )}
                  {avatarMode ? (
                    <div className="ppt-explainer-dialog__avatar">
                      <Select
                        value={speaker.avatarChoice || undefined}
                        placeholder="选择数字人素材或输入 ID / URL"
                        options={avatarOptions}
                        filterable
                        creatable
                        disabled={loading}
                        onChange={(avatarChoice) =>
                          updateSpeaker(index, {
                            avatarChoice: String(avatarChoice || ''),
                          })
                        }
                      />
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
            {usesReferenceAudio ? (
              <Checkbox
                checked={Boolean(draft.voiceCloneConsent)}
                disabled={loading}
                onChange={(voiceCloneConsent) => {
                  setSubmitError(null);
                  setDraft((current) => ({
                    ...current,
                    voiceCloneConsent,
                  }));
                }}
              >
                我确认已获得音频中声音本人的明确授权，同意用于本次讲解视频的声音克隆
              </Checkbox>
            ) : null}
          </section>
        </div>
      </Dialog>
      {confirmDialog}
      {audioLibrarySpeakerIndex !== null ? (
        <MediaLibraryModal
          isOpen
          mode={SelectionMode.SELECT}
          filterType={AssetType.AUDIO}
          selectButtonText="用作声音样本"
          onSelect={handleAudioAssetSelect}
          onClose={() => setAudioLibrarySpeakerIndex(null)}
        />
      ) : null}
    </>
  );
};
