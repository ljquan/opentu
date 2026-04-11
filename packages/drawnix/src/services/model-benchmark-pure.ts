import type { ModelType } from '../constants/model-config';

export type BenchmarkModality = ModelType;
export type BenchmarkRankingMode = 'speed' | 'cost' | 'balanced';

export interface BenchmarkPromptPreset {
  id: string;
  modality: BenchmarkModality;
  label: string;
  prompt: string;
  size?: string;
  duration?: number;
  title?: string;
  tags?: string;
}

export interface BenchmarkRankableEntry {
  status: 'pending' | 'running' | 'completed' | 'failed';
  firstResponseMs: number | null;
  totalDurationMs: number | null;
  estimatedCost: number | null;
  userScore: number | null;
}

export const BENCHMARK_PROMPT_PRESETS: BenchmarkPromptPreset[] = [
  {
    id: 'text-fast-json',
    modality: 'text',
    label: '极速短问答',
    prompt:
      '请只输出一行 JSON：{"animal":"cat","emoji":"🐱","lang":"zh"}',
  },
  {
    id: 'image-single-object',
    modality: 'image',
    label: '单物体白底',
    prompt: '一个橙色陶瓷马克杯，白色背景，简洁产品图',
    size: '1024x1024',
  },
  {
    id: 'video-single-shot',
    modality: 'video',
    label: '单镜头短视频',
    prompt: '白色背景下，一个橙色马克杯缓慢旋转，单镜头，干净光线',
    size: '1280x720',
    duration: 5,
  },
  {
    id: 'audio-short-instrumental',
    modality: 'audio',
    label: '短音乐片段',
    prompt: '轻快 lo-fi 钢琴旋律，无人声，简洁温暖',
    title: 'Benchmark Sample',
    tags: 'lofi,piano,instrumental',
  },
];

function compareNullableNumber(
  left: number | null,
  right: number | null,
  fallback = Number.MAX_SAFE_INTEGER
): number {
  return (left ?? fallback) - (right ?? fallback);
}

export function getDefaultPromptPreset(
  modality: BenchmarkModality
): BenchmarkPromptPreset {
  const preset = BENCHMARK_PROMPT_PRESETS.find(
    (item) => item.modality === modality
  );
  if (!preset) {
    throw new Error(`缺少默认测试提示词：${modality}`);
  }
  return preset;
}

export function resolvePromptPreset(
  presetId: string | null | undefined,
  modality: BenchmarkModality
): BenchmarkPromptPreset {
  return (
    BENCHMARK_PROMPT_PRESETS.find((preset) => preset.id === presetId) ||
    getDefaultPromptPreset(modality)
  );
}

export function rankBenchmarkEntries<T extends BenchmarkRankableEntry>(
  entries: T[],
  rankingMode: BenchmarkRankingMode
): T[] {
  const ranked = [...entries];
  ranked.sort((left, right) => {
    if (left.status === 'completed' && right.status !== 'completed') return -1;
    if (left.status !== 'completed' && right.status === 'completed') return 1;

    if (rankingMode === 'cost') {
      const costDelta = compareNullableNumber(
        left.estimatedCost,
        right.estimatedCost
      );
      if (costDelta !== 0) return costDelta;
    }

    const speedDelta = compareNullableNumber(
      left.firstResponseMs ?? left.totalDurationMs,
      right.firstResponseMs ?? right.totalDurationMs
    );
    if (speedDelta !== 0) {
      return speedDelta;
    }

    if (rankingMode === 'balanced' || rankingMode === 'cost') {
      const scoreDelta = (right.userScore ?? -1) - (left.userScore ?? -1);
      if (scoreDelta !== 0) {
        return scoreDelta;
      }
    }

    return compareNullableNumber(left.totalDurationMs, right.totalDurationMs);
  });
  return ranked;
}
