import type { VideoModelConfig } from '../types/video.types';

// Exact contracts from Tuzi's public /api/pricing catalog (2026-11-14).
// Keep future versions out of these contracts until their parameters are known.
export const HAPPYHORSE_11_MODEL_IDS = [
  'happyhorse-1.1-t2v',
  'happyhorse-1.1-i2v',
  'happyhorse-1.1-r2v',
];

export const TUZI_VIDEO_MODEL_SHORT_CODES: Readonly<Record<string, string>> = {
  'gemini-omni-1.2-flash': 'omni12',
  'wan3.0-video': 'wan30',
  'kling-4.0': 'k40',
  'happyhorse-1.1-t2v': 'h11t',
  'happyhorse-1.1-i2v': 'h11i',
  'happyhorse-1.1-r2v': 'h11r',
};

const durations = (min: number, max: number) =>
  Array.from({ length: max - min + 1 }, (_, index) => {
    const value = String(min + index);
    return { label: `${value}秒`, value };
  });

const resolutions = (values: string[]) =>
  values.map((value) => ({
    label: value,
    value,
    aspectRatio: 'resolution',
  }));

export const TUZI_VIDEO_MODEL_CONFIGS: Record<string, VideoModelConfig> = {
  'gemini-omni-1.2-flash': {
    id: 'gemini-omni-1.2-flash',
    label: 'Gemini Omni 1.2 Flash',
    provider: 'veo',
    description: '3–15 秒音视频生成，支持横屏和竖屏',
    durationOptions: durations(3, 15),
    defaultDuration: '10',
    sizeOptions: [
      ['360p', '640x360', '360x640'],
      ['720p', '1280x720', '720x1280'],
      ['1080p', '1920x1080', '1080x1920'],
      ['4K', '3840x2160', '2160x3840'],
    ].flatMap(([label, landscape, portrait]) => [
      { label: `${label} · 16:9`, value: landscape, aspectRatio: '16:9' },
      { label: `${label} · 9:16`, value: portrait, aspectRatio: '9:16' },
    ]),
    defaultSize: '1280x720',
    imageUpload: { maxCount: 1, mode: 'reference', labels: ['参考图'] },
  },
  'wan3.0-video': {
    id: 'wan3.0-video',
    label: 'Wan 3.0 Video',
    provider: 'wan',
    description: '2–30 秒，480P / 720P / 1080P，支持首尾帧',
    durationOptions: durations(2, 30),
    defaultDuration: '5',
    sizeOptions: resolutions(['1080P', '720P', '480P']),
    defaultSize: '1080P',
    imageUpload: { maxCount: 2, mode: 'frames', labels: ['首帧', '尾帧'] },
  },
  'kling-4.0': {
    id: 'kling-4.0',
    label: 'Kling 4.0',
    provider: 'kling',
    description: '3–30 秒，720p / 1080p，使用统一视频任务接口',
    durationOptions: durations(3, 30),
    defaultDuration: '10',
    sizeOptions: resolutions(['1080p', '720p']).map((option) => ({
      ...option,
      label: option.label.toUpperCase(),
    })),
    defaultSize: '1080p',
    imageUpload: {
      maxCount: 10,
      mode: 'reference',
      labels: Array.from({ length: 10 }, (_, i) => `参考图${i + 1}`),
    },
  },
  ...Object.fromEntries(
    HAPPYHORSE_11_MODEL_IDS.map((id): [string, VideoModelConfig] => {
      const isI2V = id.endsWith('-i2v');
      const count = id.endsWith('-t2v') ? 0 : isI2V ? 1 : 9;
      return [
        id,
        {
          id,
          label: `HappyHorse 1.1 ${id.slice(-3).toUpperCase()}`,
          provider: 'happyhorse',
          description: isI2V
            ? '首帧图生视频，比例跟随首帧'
            : count
            ? '1–9 张参考图生视频'
            : '文生视频',
          durationOptions: durations(3, 15),
          defaultDuration: '5',
          sizeOptions: resolutions(['1080P', '720P', '480P']),
          defaultSize: '1080P',
          imageUpload: {
            maxCount: count,
            mode: 'reference',
            required: count > 0,
            labels: isI2V
              ? ['首帧']
              : Array.from({ length: count }, (_, i) => `参考图${i + 1}`),
          },
        },
      ];
    })
  ),
};

export function getTuziVideoModelConfig(
  modelId: string
): VideoModelConfig | undefined {
  const id = modelId.toLowerCase();
  return Object.prototype.hasOwnProperty.call(TUZI_VIDEO_MODEL_CONFIGS, id)
    ? TUZI_VIDEO_MODEL_CONFIGS[id]
    : undefined;
}

export const KLING_4_RATIO_OPTIONS = [
  'adaptive',
  '16:9',
  '9:16',
  '1:1',
  '21:9',
];

// Exact sizes previously saved by the combined resolution/aspect selector.
const LEGACY_KLING_4_SIZES = Object.fromEntries(
  [1080, 720].flatMap((height) => [
    [`${(height * 16) / 9}x${height}`, { size: `${height}p`, ratio: '16:9' }],
    [`${height}x${(height * 16) / 9}`, { size: `${height}p`, ratio: '9:16' }],
    [`${height}x${height}`, { size: `${height}p`, ratio: '1:1' }],
    [`${(height * 21) / 9}x${height}`, { size: `${height}p`, ratio: '21:9' }],
  ])
) as Record<string, { size: string; ratio: string }>;

export function normalizeKling4VideoParams<T extends Record<string, unknown>>(
  modelId: string,
  params: T
): T {
  if (modelId.toLowerCase() !== 'kling-4.0' || typeof params.size !== 'string')
    return params;
  const legacy = Object.prototype.hasOwnProperty.call(
    LEGACY_KLING_4_SIZES,
    params.size
  )
    ? LEGACY_KLING_4_SIZES[params.size]
    : undefined;
  return legacy
    ? { ...params, size: legacy.size, ratio: params.ratio || legacy.ratio }
    : params;
}
