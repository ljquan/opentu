import type { VideoModelConfig } from '../types/video.types';

// Exact contracts from Tuzi's public /api/pricing catalog (2026-11-14).
// Keep future versions out of these contracts until their parameters are known.
export const HAPPYHORSE_11_MODEL_IDS = [
  'happyhorse-1.1-t2v',
  'happyhorse-1.1-i2v',
  'happyhorse-1.1-r2v',
];

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
    sizeOptions: ['1080p', '720p'].flatMap((resolution) => {
      const height = resolution === '1080p' ? 1080 : 720;
      return [
        {
          label: `${resolution} · 自适应`,
          value: resolution,
          aspectRatio: 'adaptive',
        },
        {
          label: `${resolution} · 16:9`,
          value: `${(height * 16) / 9}x${height}`,
          aspectRatio: '16:9',
        },
        {
          label: `${resolution} · 9:16`,
          value: `${height}x${(height * 16) / 9}`,
          aspectRatio: '9:16',
        },
        {
          label: `${resolution} · 1:1`,
          value: `${height}x${height}`,
          aspectRatio: '1:1',
        },
        {
          label: `${resolution} · 21:9`,
          value: `${(height * 21) / 9}x${height}`,
          aspectRatio: '21:9',
        },
      ];
    }),
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
