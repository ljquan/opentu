import type { Task } from '../../types/task.types';
import { isPublicHttpMediaUrl } from '../../utils/virtual-media-url';
import {
  PPT_EXPLAINER_SCHEMA_VERSION,
  type PptExplainerPresenterMode,
  type PptExplainerSpeakerInput,
  type PptExplainerSlide,
  type PptExplainerSpeaker,
  type PptExplainerTaskState,
  type PptExplainerVoiceSource,
} from './types';

export class PptExplainerValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PptExplainerValidationError';
  }
}

function requiredSpeakerCount(mode: PptExplainerPresenterMode): number {
  return mode === 'dual_voice' || mode === 'dual_avatar' ? 2 : 1;
}

function isAvatarMode(mode: PptExplainerPresenterMode): boolean {
  return mode === 'single_avatar' || mode === 'dual_avatar';
}

const SENSITIVE_AVATAR_QUERY_KEY_RE =
  /(?:api[-_]?key|access[-_]?token|authorization|auth|token|secret|signature|credential|password|passwd|cookie|key)/i;

function hasSensitiveAvatarQuery(url: URL): boolean {
  for (const key of url.searchParams.keys()) {
    let candidate = key;
    for (let round = 0; round < 8; round += 1) {
      if (SENSITIVE_AVATAR_QUERY_KEY_RE.test(candidate)) return true;
      let decoded: string;
      try {
        decoded = decodeURIComponent(candidate);
      } catch {
        break;
      }
      if (decoded === candidate) break;
      candidate = decoded;
    }
  }
  return false;
}

export function isProviderReachableAvatarUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      !url.username &&
      !url.password &&
      !url.hash &&
      !hasSensitiveAvatarQuery(url) &&
      isPublicHttpMediaUrl(url.toString()) &&
      !url.pathname.startsWith('/__aitu_')
    );
  } catch {
    return false;
  }
}

export function validatePptExplainerSpeakers(
  mode: PptExplainerPresenterMode,
  speakers: readonly (PptExplainerSpeaker | PptExplainerSpeakerInput)[],
  options: { requireVoice?: boolean } = {}
): void {
  const expectedCount = requiredSpeakerCount(mode);
  if (speakers.length !== expectedCount) {
    throw new PptExplainerValidationError(
      expectedCount === 2
        ? '双人模式必须配置两位讲解者'
        : '单人模式必须配置一位讲解者'
    );
  }

  const speakerIds = new Set<string>();
  const voiceIdentities = new Set<string>();
  for (const speaker of speakers) {
    const id = speaker.id.trim();
    const displayName = speaker.displayName.trim();
    if (!id || !displayName) {
      throw new PptExplainerValidationError(
        '每位讲解者都必须配置名称和 speaker ID'
      );
    }
    if (speakerIds.has(id)) {
      throw new PptExplainerValidationError('speaker ID 不能重复');
    }
    speakerIds.add(id);
    if (options.requireVoice === false) continue;
    const voiceSource = getPptExplainerSpeakerVoiceSource(speaker);
    const inputReference =
      'referenceAudio' in speaker ? speaker.referenceAudio : undefined;
    const persistedReference =
      'voiceReference' in speaker ? speaker.voiceReference : undefined;
    let voiceIdentity: string;
    if (voiceSource === 'voice_id') {
      const voiceId = speaker.voiceId?.trim();
      if (!voiceId || inputReference || persistedReference) {
        throw new PptExplainerValidationError(
          `讲解者「${displayName}」必须且只能配置声音 ID`
        );
      }
      voiceIdentity = `voice:${voiceId}`;
    } else {
      if (speaker.voiceId?.trim() || (!inputReference && !persistedReference)) {
        throw new PptExplainerValidationError(
          `讲解者「${displayName}」必须且只能配置参考音频`
        );
      }
      if (inputReference) {
        const file = inputReference.file;
        if (
          (!file &&
            (!inputReference.sourceAssetId || !inputReference.sourceUrl)) ||
          (file && file.size <= 0)
        ) {
          throw new PptExplainerValidationError(
            `讲解者「${displayName}」的参考音频不可用`
          );
        }
        const mimeType = inferPptExplainerAudioMimeType(
          inputReference.mimeType || file?.type,
          inputReference.filename || file?.name
        );
        if (!mimeType) {
          throw new PptExplainerValidationError(
            `讲解者「${displayName}」的参考音频格式不受支持`
          );
        }
        voiceIdentity = inputReference.sourceAssetId
          ? `asset:${inputReference.sourceAssetId}`
          : `file:${file?.name}:${file?.size}:${file?.lastModified}`;
      } else {
        if (
          !persistedReference?.cacheUrl.trim() ||
          !persistedReference.assetName.trim() ||
          persistedReference.size <= 0 ||
          !inferPptExplainerAudioMimeType(
            persistedReference.mimeType,
            persistedReference.filename
          )
        ) {
          throw new PptExplainerValidationError(
            `讲解者「${displayName}」的参考音频缓存无效`
          );
        }
        voiceIdentity = persistedReference.sourceAssetId
          ? `asset:${persistedReference.sourceAssetId}`
          : `sample:${persistedReference.cacheUrl}`;
      }
    }
    if (expectedCount === 2 && voiceIdentities.has(voiceIdentity)) {
      throw new PptExplainerValidationError('双人模式必须配置两个不同声音');
    }
    voiceIdentities.add(voiceIdentity);

    if (
      isAvatarMode(mode) &&
      !speaker.avatarAssetId?.trim() &&
      !speaker.avatarSourceUrl?.trim()
    ) {
      throw new PptExplainerValidationError(
        `数字人模式缺少「${displayName}」的数字人来源`
      );
    }
    if (
      isAvatarMode(mode) &&
      speaker.avatarSourceUrl?.trim() &&
      !isProviderReachableAvatarUrl(speaker.avatarSourceUrl.trim())
    ) {
      throw new PptExplainerValidationError(
        `数字人「${displayName}」必须使用供应商数字人 ID 或可公开访问的 HTTP(S) URL`
      );
    }
  }
}

const AUDIO_EXTENSION_MIME_TYPES: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  webm: 'audio/webm',
  flac: 'audio/flac',
};

export function inferPptExplainerAudioMimeType(
  mimeType?: string,
  filename?: string
): string | null {
  const normalized = mimeType?.trim().toLowerCase() || '';
  if (normalized.startsWith('audio/')) return normalized;
  const extension = filename?.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  return extension ? AUDIO_EXTENSION_MIME_TYPES[extension] || null : null;
}

export function getPptExplainerSpeakerVoiceSource(
  speaker: PptExplainerSpeaker | PptExplainerSpeakerInput
): PptExplainerVoiceSource {
  if (speaker.voiceSource) return speaker.voiceSource;
  return ('voiceReference' in speaker && speaker.voiceReference) ||
    ('referenceAudio' in speaker && speaker.referenceAudio)
    ? 'reference_audio'
    : 'voice_id';
}

export function hasPptExplainerReferenceAudio(
  speakers: readonly (PptExplainerSpeaker | PptExplainerSpeakerInput)[]
): boolean {
  return speakers.some(
    (speaker) =>
      getPptExplainerSpeakerVoiceSource(speaker) === 'reference_audio'
  );
}

export function validatePptExplainerSlides(
  slides: readonly PptExplainerSlide[],
  speakers: readonly PptExplainerSpeaker[],
  options: { requireSnapshots?: boolean; requireTurns?: boolean } = {}
): void {
  if (slides.length === 0) {
    throw new PptExplainerValidationError('演示文稿没有可用页面');
  }
  const speakerIds = new Set(speakers.map((speaker) => speaker.id));
  const pageIndexes = new Set<number>();

  for (const slide of slides) {
    if (!Number.isSafeInteger(slide.pageIndex) || slide.pageIndex < 1) {
      throw new PptExplainerValidationError('页面序号必须是从 1 开始的整数');
    }
    if (pageIndexes.has(slide.pageIndex)) {
      throw new PptExplainerValidationError(`页面序号 ${slide.pageIndex} 重复`);
    }
    pageIndexes.add(slide.pageIndex);
    if (options.requireSnapshots && !slide.snapshotUrl?.trim()) {
      throw new PptExplainerValidationError(
        `第 ${slide.pageIndex} 页缺少页面快照`
      );
    }
    if (options.requireTurns && slide.turns.length === 0) {
      throw new PptExplainerValidationError(`第 ${slide.pageIndex} 页缺少讲稿`);
    }
    for (const turn of slide.turns) {
      if (!speakerIds.has(turn.speakerId)) {
        throw new PptExplainerValidationError(
          `第 ${slide.pageIndex} 页讲稿引用了未知 speaker`
        );
      }
      if (!turn.text.trim()) {
        throw new PptExplainerValidationError(
          `第 ${slide.pageIndex} 页包含空讲稿`
        );
      }
      if (
        turn.estimatedDurationSeconds !== undefined &&
        (!Number.isFinite(turn.estimatedDurationSeconds) ||
          turn.estimatedDurationSeconds < 0)
      ) {
        throw new PptExplainerValidationError(
          `第 ${slide.pageIndex} 页讲稿时长估计无效`
        );
      }
    }
  }
}

export function readPptExplainerState(
  task: Pick<Task, 'params'>
): PptExplainerTaskState | null {
  const value = task.params?.pptExplainer as
    | Partial<PptExplainerTaskState>
    | undefined;
  return value?.schemaVersion === PPT_EXPLAINER_SCHEMA_VERSION
    ? (value as PptExplainerTaskState)
    : null;
}

export function isPptExplainerTask(
  task: Pick<Task, 'type' | 'params'>
): boolean {
  return task.type === 'video' && readPptExplainerState(task) !== null;
}

const BASE64_DATA_PREFIX_RE = /^\s*(?:base64:|data:[^,\r\n]*;\s*base64\s*,)/i;
const RAW_BASE64_MIN_LENGTH = 1024;
const RAW_BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

function isEncodedBinaryString(value: string): boolean {
  if (BASE64_DATA_PREFIX_RE.test(value)) return true;
  return (
    value.length >= RAW_BASE64_MIN_LENGTH &&
    value.length % 4 === 0 &&
    RAW_BASE64_RE.test(value)
  );
}

export function assertPersistablePptExplainerState(
  state: PptExplainerTaskState
): void {
  const seen = new Set<unknown>();
  const visit = (value: unknown, path: string): void => {
    if (value === null || value === undefined) return;
    if (
      (typeof Blob !== 'undefined' && value instanceof Blob) ||
      (typeof File !== 'undefined' && value instanceof File)
    ) {
      throw new PptExplainerValidationError(`${path} 不得持久化二进制对象`);
    }
    if (typeof value === 'string' && isEncodedBinaryString(value)) {
      throw new PptExplainerValidationError(`${path} 不得持久化 base64 数据`);
    }
    if (typeof value !== 'object') return;
    if (seen.has(value)) {
      throw new PptExplainerValidationError(`${path} 包含循环引用`);
    }
    seen.add(value);
    for (const [key, child] of Object.entries(value)) {
      if (
        /(?:api[-_.\s]?key|authorization|proxy[-_.\s]?authorization|access[-_.\s]?token|refresh[-_.\s]?token|token|secret|cookie|credential|password|passwd|signature)/i.test(
          key
        )
      ) {
        throw new PptExplainerValidationError(`${path}.${key} 不得持久化凭据`);
      }
      visit(child, `${path}.${key}`);
    }
    seen.delete(value);
  };
  visit(state, 'pptExplainer');
}
