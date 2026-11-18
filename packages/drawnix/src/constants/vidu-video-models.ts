import type { VideoModelConfig } from '../types/video.types';

export const VIDU_MIX_MODEL = 'viduq3-mix';
export const VIDU_MIX_RATIOS = ['16:9', '9:16', '1:1', '3:4', '4:3', 'auto'] as const;

export type ViduVideoAction =
  | 'textGenerate'
  | 'generate'
  | 'firstTailGenerate'
  | 'referenceGenerate';

interface ViduVideoContract {
  label: string;
  shortCode: string;
  actions: ViduVideoAction[];
  minDuration: number;
  maxDuration: number;
  resolutions: string[];
  maxImages: number;
  defaultDuration?: string;
  defaultSize?: string;
}

// Tuzi's exact public contracts, verified 2026-11-17. Do not match future suffixes.
export const VIDU_VIDEO_CONTRACTS: Readonly<Record<string, ViduVideoContract>> =
  {
    'viduq3-ad': {
      label: 'Vidu Q3 Ad',
      shortCode: 'q3ad',
      actions: ['referenceGenerate'],
      minDuration: 3,
      maxDuration: 15,
      resolutions: ['720p', '1080p'],
      maxImages: 7,
    },
    'viduq3-drama': {
      label: 'Vidu Q3 Drama',
      shortCode: 'q3dr',
      actions: ['referenceGenerate'],
      minDuration: 2,
      maxDuration: 16,
      resolutions: ['720p', '1080p'],
      maxImages: 7,
      defaultDuration: '8',
      defaultSize: '1080p',
    },
    viduq3: {
      label: 'Vidu Q3',
      shortCode: 'q3',
      actions: ['referenceGenerate'],
      minDuration: 3,
      maxDuration: 16,
      resolutions: ['540p', '720p', '1080p'],
      maxImages: 7,
    },
    'viduq3-turbo': {
      label: 'Vidu Q3 Turbo',
      shortCode: 'q3t',
      actions: [
        'textGenerate',
        'generate',
        'firstTailGenerate',
        'referenceGenerate',
      ],
      minDuration: 1,
      maxDuration: 16,
      resolutions: ['540p', '720p', '1080p'],
      maxImages: 7,
    },
    'viduq3-pro-fast': {
      label: 'Vidu Q3 Pro Fast',
      shortCode: 'q3pf',
      actions: ['generate', 'firstTailGenerate'],
      minDuration: 1,
      maxDuration: 16,
      resolutions: ['720p', '1080p'],
      maxImages: 2,
    },
    'viduq3-pro': {
      label: 'Vidu Q3 Pro',
      shortCode: 'q3p',
      actions: ['textGenerate', 'generate', 'firstTailGenerate'],
      minDuration: 1,
      maxDuration: 16,
      resolutions: ['540p', '720p', '1080p'],
      maxImages: 2,
    },
    'viduq4-preview': {
      label: 'Vidu Q4 Preview',
      shortCode: 'q4p',
      actions: ['generate', 'referenceGenerate'],
      minDuration: 3,
      maxDuration: 16,
      resolutions: ['540p', '720p', '1080p', '2K', '4K'],
      maxImages: 15,
    },
    'viduq3-mix': {
      label: 'Vidu Q3 Mix',
      shortCode: 'q3m',
      actions: ['referenceGenerate'],
      minDuration: 3,
      maxDuration: 15,
      resolutions: ['720p', '1080p'],
      maxImages: 7,
    },
  };

export const VIDU_ACTION_LABELS: Record<ViduVideoAction, string> = {
  textGenerate: '文生视频',
  generate: '图生视频',
  firstTailGenerate: '首尾帧',
  referenceGenerate: '参考生视频',
};

export function getViduVideoContract(
  model: string
): ViduVideoContract | undefined {
  const id = model.toLowerCase();
  return Object.prototype.hasOwnProperty.call(VIDU_VIDEO_CONTRACTS, id)
    ? VIDU_VIDEO_CONTRACTS[id]
    : undefined;
}

export function getViduDurationOptions(model: string, action?: unknown) {
  const contract = getViduVideoContract(model);
  if (!contract) return [];
  const turboReference =
    model.toLowerCase() === 'viduq3-turbo' && action === 'referenceGenerate';
  const min = turboReference ? 3 : contract.minDuration;
  const max = turboReference ? 15 : contract.maxDuration;
  return Array.from({ length: max - min + 1 }, (_, index) => ({
    label: `${min + index}秒`,
    value: String(min + index),
  }));
}

export function resolveViduVideoAction(
  model: string,
  selected: unknown,
  imageCount: number
): ViduVideoAction {
  const contract = getViduVideoContract(model);
  if (!contract) throw new Error('未知 Vidu 型号');
  let action = selected;
  if (action === undefined || action === 'auto') {
    action =
      contract.actions.length === 1
        ? contract.actions[0]
        : imageCount === 0 && contract.actions.includes('textGenerate')
        ? 'textGenerate'
        : imageCount === 1 && contract.actions.includes('generate')
        ? 'generate'
        : imageCount === 2 && contract.actions.includes('firstTailGenerate')
        ? 'firstTailGenerate'
        : contract.actions.includes('referenceGenerate')
        ? 'referenceGenerate'
        : 'generate';
  }
  if (!contract.actions.includes(action as ViduVideoAction))
    throw new Error(`${model} 不支持该视频动作`);
  return action as ViduVideoAction;
}

export const VIDU_VIDEO_MODEL_CONFIGS: Record<string, VideoModelConfig> =
  Object.fromEntries(
    Object.entries(VIDU_VIDEO_CONTRACTS).map(([id, contract]) => [
      id,
      {
        id,
        label: contract.label,
        provider: 'vidu',
        description: `${contract.minDuration}–${
          contract.maxDuration
        } 秒，${contract.actions
          .map((action) => VIDU_ACTION_LABELS[action])
          .join(' / ')}`,
        durationOptions: getViduDurationOptions(id),
        defaultDuration: contract.defaultDuration || '5',
        sizeOptions: contract.resolutions.map((value) => ({
          label: value,
          value,
          aspectRatio: 'resolution',
        })),
        defaultSize: contract.defaultSize || '720p',
        imageUpload: {
          maxCount: contract.maxImages,
          mode: 'reference',
          required: !contract.actions.includes('textGenerate'),
          labels: Array.from(
            { length: contract.maxImages },
            (_, index) => `图片${index + 1}`
          ),
        },
      },
    ])
  );
