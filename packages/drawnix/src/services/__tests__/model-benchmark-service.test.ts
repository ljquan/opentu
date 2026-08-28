import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyShiftRangeSelection,
  getDefaultPromptPreset,
  reconcileSelection,
  rankBenchmarkEntries,
  type BenchmarkRankableEntry,
} from '../model-benchmark-pure';
import { ModelVendor } from '../../constants/model-config';

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
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.doUnmock('../kv-storage-service');
    vi.doUnmock('../utils/gemini-api');
    vi.doUnmock('../utils/settings-manager');
    vi.doUnmock('../utils/umami-analytics');
    vi.doUnmock('../model-adapters');
  });

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

  it('reconciles batch selections and defaults to all available targets', () => {
    expect(reconcileSelection([], ['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
    expect(reconcileSelection(['x', 'b'], ['a', 'b', 'c'])).toEqual(['b']);
  });

  it('supports first-n fallback for lightweight custom presets', () => {
    expect(
      reconcileSelection([], ['a', 'b', 'c'], {
        fallback: 'first',
        limit: 2,
      })
    ).toEqual(['a', 'b']);
  });

  it('supports shift range selection for batch picking', () => {
    expect(
      applyShiftRangeSelection(['a'], ['a', 'b', 'c', 'd'], 'a', 'c', true)
    ).toEqual(['a', 'b', 'c']);
    expect(
      applyShiftRangeSelection(['a', 'b', 'c'], ['a', 'b', 'c', 'd'], 'a', 'c', false)
    ).toEqual([]);
  });

  it('uses the benchmark entry ID for image requests', async () => {
    const generateImage = vi.fn(async () => ({
      url: 'https://example.com/benchmark.png',
      format: 'png',
    }));

    vi.doMock('../kv-storage-service', () => ({
      kvStorageService: {
        isAvailable: () => false,
        get: vi.fn(),
        set: vi.fn(async () => {}),
      },
    }));
    vi.doMock('../utils/gemini-api', () => ({
      defaultGeminiClient: { sendChat: vi.fn() },
    }));
    vi.doMock('../utils/settings-manager', () => ({
      createModelRef: (profileId: string, modelId: string) => ({
        profileId,
        modelId,
      }),
    }));
    vi.doMock('../utils/umami-analytics', () => ({
      analytics: { track: vi.fn() },
    }));
    vi.doMock('../model-adapters', () => ({
      resolveAdapterForInvocation: vi.fn(() => ({
        id: 'benchmark-image-adapter',
        kind: 'image',
        generateImage,
      })),
      getAdapterContextFromSettings: vi.fn(() => ({
        baseUrl: 'https://api.example.com/v1',
        apiKey: 'test-key',
      })),
    }));

    const { modelBenchmarkService } = await import(
      '../model-benchmark-service'
    );
    const session = modelBenchmarkService.createSession({
      modality: 'image',
      compareMode: 'custom',
      promptPresetId: 'image-single-object',
      prompt: '生成一张测试图片',
      rankingMode: 'speed',
      targets: [
        {
          profileId: 'provider-test',
          profileName: 'Test Provider',
          modelId: 'image-model',
          modelLabel: 'Image Model',
          modality: 'image',
          vendor: ModelVendor.GPT,
          selectionKey: 'provider-test::image-model',
        },
      ],
    });
    const entryId = session.entries[0]?.id;

    await modelBenchmarkService.runSession(session.id, 1);

    expect(generateImage).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: entryId }),
      expect.objectContaining({ model: 'image-model' })
    );
  });
});
