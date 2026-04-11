import { describe, expect, it } from 'vitest';
import {
  getDefaultPromptPreset,
  rankBenchmarkEntries,
  type BenchmarkRankableEntry,
} from '../model-benchmark-pure';

function createEntry(
  overrides: Partial<BenchmarkRankableEntry> & { id?: string }
) {
  return {
    id: overrides.id || 'entry',
    status: overrides.status || 'completed',
    firstResponseMs: overrides.firstResponseMs ?? 1000,
    totalDurationMs: overrides.totalDurationMs ?? 1500,
    estimatedCost: overrides.estimatedCost ?? null,
    userScore: overrides.userScore ?? null,
  };
}

describe('model-benchmark-service', () => {
  it('returns a low-cost default preset per modality', () => {
    expect(getDefaultPromptPreset('text').id).toBe('text-fast-json');
    expect(getDefaultPromptPreset('image').id).toBe('image-single-object');
    expect(getDefaultPromptPreset('video').id).toBe('video-single-shot');
    expect(getDefaultPromptPreset('audio').id).toBe('audio-short-instrumental');
  });

  it('prefers faster completed entries in speed mode', () => {
    const ranked = rankBenchmarkEntries(
      [
        createEntry({ id: 'slow', firstResponseMs: 3200, totalDurationMs: 4500 }),
        createEntry({ id: 'fast', firstResponseMs: 900, totalDurationMs: 1300 }),
        createEntry({ id: 'failed', status: 'failed', firstResponseMs: null }),
      ],
      'speed'
    );

    expect(ranked.map((entry) => entry.id)).toEqual(['fast', 'slow', 'failed']);
  });

  it('prefers cheaper entries in cost mode before score tiebreakers', () => {
    const ranked = rankBenchmarkEntries(
      [
        createEntry({ id: 'cheap', estimatedCost: 0.01, userScore: 3 }),
        createEntry({ id: 'expensive', estimatedCost: 0.2, userScore: 5 }),
      ],
      'cost'
    );

    expect(ranked[0]?.id).toBe('cheap');
  });
});
