import { afterEach, describe, expect, it } from 'vitest';
import {
  clearRuntimeModelConfigs,
  ModelVendor,
  setRuntimeModelConfigs,
  type ModelConfig,
} from '../../constants/model-config';
import {
  buildImageInspectionCases,
  collectImageInspectionTargets,
  formatImageInspectionFormula,
  IMAGE_INSPECTION_MODEL_IDS,
  isImageInspectionModel,
  parseImageDimensionsFromUrl,
  resolveImageInspectionAutoRunAction,
  resolveImageInspectionResultPage,
  resolveImageInspectionResolutionParams,
  validateImageInspectionDimensionSources,
  validateImageInspectionDimensions,
} from '../image-inspection-pure';

function model(id: string): ModelConfig {
  return {
    id,
    label: id,
    shortLabel: id,
    type: 'image',
    vendor: /gemini|nano/.test(id) ? ModelVendor.GEMINI : ModelVendor.GPT,
  };
}

describe('image-inspection-pure', () => {
  afterEach(() => {
    clearRuntimeModelConfigs();
  });

  it('builds the full GPT Image 2 exact-size matrix', () => {
    const cases = buildImageInspectionCases([
      {
        profileId: 'default',
        profileName: 'default 分组',
        model: model('gpt-image-2'),
      },
    ]);

    expect(cases).toHaveLength(30);
    expect(
      cases.find(
        (item) =>
          item.requestedAspectRatio === '16x9' &&
          item.requestedResolution === '4k'
      )
    ).toMatchObject({
      expectedSize: '3840x2160',
      expectedWidth: 3840,
      expectedHeight: 2160,
      resolutionParamId: 'resolution',
    });
  });

  it.each(IMAGE_INSPECTION_MODEL_IDS)('仅纳入指定的巡检模型：%s', (modelId) => {
    expect(isImageInspectionModel(model(modelId))).toBe(true);
    expect(
      buildImageInspectionCases([
        {
          profileId: 'allowed-profile',
          profileName: '白名单分组',
          model: model(modelId),
        },
      ]).length
    ).toBeGreaterThan(0);
  });

  it('每个完整分组共生成 182 个白名单巡检用例', () => {
    const cases = buildImageInspectionCases(
      IMAGE_INSPECTION_MODEL_IDS.map((modelId) => ({
        profileId: 'complete-profile',
        profileName: '完整分组',
        model: model(modelId),
      }))
    );

    expect(cases).toHaveLength(182);
    expect(new Set(cases.map((item) => item.modelId))).toEqual(
      new Set(IMAGE_INSPECTION_MODEL_IDS)
    );
  });

  it('大报表按最新结果每页 100 条分页', () => {
    expect(resolveImageInspectionResultPage(1310, 0, 100)).toEqual({
      totalPages: 14,
      pageFromLatest: 0,
      start: 1210,
      end: 1310,
    });
    expect(resolveImageInspectionResultPage(1310, 13, 100)).toEqual({
      totalPages: 14,
      pageFromLatest: 13,
      start: 0,
      end: 10,
    });
    expect(resolveImageInspectionResultPage(0, 99, 0)).toEqual({
      totalPages: 1,
      pageFromLatest: 0,
      start: 0,
      end: 0,
    });
  });

  it.each([
    ['gpt-image-2-vip', 30, ['1k', '2k', '4k'], 'resolution'],
    ['gpt-image-2', 30, ['1k', '2k', '4k'], 'resolution'],
    ['gemini-3.1-flash-image-preview', 42, ['1k', '2k', '4k'], 'quality'],
    ['gemini-3-pro-image-preview', 30, ['1k', '2k', '4k'], 'quality'],
    ['gemini-3-pro-image-preview-2k-vip', 10, ['2k'], null],
    ['gemini-3-pro-image-preview-4k-vip', 10, ['4k'], null],
    ['gemini-3.1-flash-image-preview-4k', 10, ['4k'], null],
    ['gemini-3.1-flash-image-preview-2k', 10, ['2k'], null],
    ['gemini-3-pro-image-preview-4k-async', 10, ['4k'], null],
  ] as const)(
    '保持指定模型的完整比例和档位矩阵：%s',
    (modelId, expectedCount, expectedResolutions, expectedParamId) => {
      const cases = buildImageInspectionCases([
        {
          profileId: 'matrix-profile',
          profileName: '矩阵分组',
          model: model(modelId),
        },
      ]);

      expect(cases).toHaveLength(expectedCount);
      expect(
        Array.from(
          new Set(cases.map((item) => item.requestedResolution))
        ).sort()
      ).toEqual([...expectedResolutions].sort());
      expect(new Set(cases.map((item) => item.resolutionParamId))).toEqual(
        new Set([expectedParamId])
      );
    }
  );

  it('严格按模型 ID 白名单匹配，不接受大小写或空格变体', () => {
    expect(isImageInspectionModel(model('GPT-IMAGE-2'))).toBe(false);
    expect(isImageInspectionModel(model(' gpt-image-2'))).toBe(false);
    expect(isImageInspectionModel(model('gpt-image-2 '))).toBe(false);
  });

  it('动态型号传递请求档位，固定档位型号不重复传参', () => {
    const cases = buildImageInspectionCases([
      {
        profileId: 'params-profile',
        profileName: '参数分组',
        model: model('gpt-image-2'),
      },
      {
        profileId: 'params-profile',
        profileName: '参数分组',
        model: model('gemini-3-pro-image-preview'),
      },
      {
        profileId: 'params-profile',
        profileName: '参数分组',
        model: model('gemini-3-pro-image-preview-4k-vip'),
      },
    ]);
    const findCase = (modelId: string, resolution: string) => {
      const inspectionCase = cases.find(
        (item) =>
          item.modelId === modelId &&
          item.requestedAspectRatio === '1x1' &&
          item.requestedResolution === resolution
      );
      expect(inspectionCase).toBeDefined();
      return inspectionCase as (typeof cases)[number];
    };

    expect(
      resolveImageInspectionResolutionParams(findCase('gpt-image-2', '2k'))
    ).toEqual({ resolution: '2k' });
    expect(
      resolveImageInspectionResolutionParams(
        findCase('gemini-3-pro-image-preview', '4k')
      )
    ).toEqual({ quality: '4k' });
    expect(
      resolveImageInspectionResolutionParams(
        findCase('gemini-3-pro-image-preview-4k-vip', '4k')
      )
    ).toEqual({});
  });

  it('遍历所有启用分组，不依赖分组能力标记', () => {
    const targets = collectImageInspectionTargets([
      {
        profileId: 'stale-capability',
        profileName: '能力标记陈旧分组',
        enabled: true,
        models: [model('gpt-image-2'), model('gemini-custom-image-preview')],
      },
      {
        profileId: 'disabled',
        profileName: '停用分组',
        enabled: false,
        models: [model('gpt-image-2-vip')],
      },
    ]);

    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({
      profileId: 'stale-capability',
      model: { id: 'gpt-image-2' },
    });
  });

  it('builds dynamic Gemini 1K/2K/4K cases from model parameters', () => {
    const cases = buildImageInspectionCases([
      {
        profileId: 'gemini',
        profileName: 'gemini 分组',
        model: model('gemini-3.1-flash-image-preview'),
      },
    ]);

    expect(cases.some((item) => item.requestedAspectRatio === '1x8')).toBe(
      true
    );
    expect(
      cases
        .filter((item) => item.requestedAspectRatio === '1x1')
        .map((item) => item.requestedResolution)
    ).toEqual(['1k', '2k', '4k']);
    expect(cases[0]?.resolutionParamId).toBe('quality');
  });

  it.each([
    'gpt-image2-vip',
    'gpt-image2',
    'gemini-custom-image-preview',
    'gemini-3-pro-image-preview-hd',
    'nano-banana-pro',
    'gemini-3-pro-image-preview-vip',
  ])('跳过白名单以外的模型：%s', (modelId) => {
    const skippedModel = model(modelId);
    setRuntimeModelConfigs([skippedModel]);

    expect(isImageInspectionModel(skippedModel)).toBe(false);
    expect(
      buildImageInspectionCases([
        {
          profileId: 'skipped-profile',
          profileName: '非白名单分组',
          model: skippedModel,
        },
      ])
    ).toEqual([]);
  });

  it('同一白名单模型在不同分组中分别生成完整矩阵', () => {
    const cases = buildImageInspectionCases([
      {
        profileId: 'group-a',
        profileName: 'A 分组',
        model: model('gpt-image-2'),
      },
      {
        profileId: 'group-b',
        profileName: 'B 分组',
        model: model('gpt-image-2'),
      },
    ]);

    expect(cases).toHaveLength(60);
    expect(cases.filter((item) => item.profileId === 'group-a')).toHaveLength(
      30
    );
    expect(cases.filter((item) => item.profileId === 'group-b')).toHaveLength(
      30
    );
  });

  it('fails a 4K case when the actual image only reaches 2K', () => {
    const inspectionCase = buildImageInspectionCases([
      {
        profileId: 'gemini',
        profileName: 'gemini 分组',
        model: model('gemini-3-pro-image-preview-4k-vip'),
      },
    ])[0];

    const result = validateImageInspectionDimensions(inspectionCase, {
      width: 2048,
      height: 2048,
      pixels: 2048 * 2048,
    });

    expect(result.status).toBe('failed');
    expect(result.message).toContain('未达到 4K');
  });

  it.each([
    ['1x1', 2048, 2048],
    ['3x4', 1086, 1448],
    ['4x3', 2048, 1536],
    ['21x9', 1568, 672],
  ] as const)(
    'default 分组 Image 2 忽略像素档位并接受精确约分比例：%s',
    (ratio, width, height) => {
      const inspectionCase = buildImageInspectionCases([
        {
          profileId: 'default',
          profileName: 'default 分组',
          model: model('gpt-image-2-vip'),
        },
      ]).find(
        (item) =>
          item.requestedAspectRatio === ratio &&
          item.requestedResolution === '4k'
      );

      expect(inspectionCase).toBeDefined();
      expect(
        validateImageInspectionDimensions(inspectionCase!, {
          width,
          height,
          pixels: width * height,
        })
      ).toMatchObject({ status: 'passed' });
    }
  );

  it('default 分组 Image 2 的近似比例不能通过精确约分校验', () => {
    const inspectionCase = buildImageInspectionCases([
      {
        profileId: 'default',
        profileName: 'default 分组',
        model: model('gpt-image-2'),
      },
    ]).find(
      (item) =>
        item.requestedAspectRatio === '3x2' &&
        item.requestedResolution === '2k'
    );

    expect(
      validateImageInspectionDimensions(inspectionCase!, {
        width: 1535,
        height: 1024,
        pixels: 1535 * 1024,
      })
    ).toMatchObject({ status: 'failed' });
  });

  it('其他分组 Image 2 仍按精确像素尺寸校验', () => {
    const inspectionCase = buildImageInspectionCases([
      {
        profileId: 'other',
        profileName: '其他分组',
        model: model('gpt-image-2'),
      },
    ]).find(
      (item) =>
        item.requestedAspectRatio === '1x1' &&
        item.requestedResolution === '2k'
    );

    expect(
      validateImageInspectionDimensions(inspectionCase!, {
        width: 1254,
        height: 1254,
        pixels: 1254 * 1254,
      })
    ).toMatchObject({ status: 'failed' });
  });

  it('parses base-30 dimensions and formats the requested formula', () => {
    const dimensions = parseImageDimensionsFromUrl(
      'https://example.com/img/result-1l6x144-test.png'
    );

    expect(dimensions).toMatchObject({ width: 1536, height: 1024 });
    expect(formatImageInspectionFormula(dimensions, null)).toContain(
      'parseInt("1l6", 30) × parseInt("144", 30)'
    );
  });

  it('拒绝随机 URL 路径中超出合理图片范围的伪尺寸编码', () => {
    expect(
      parseImageDimensionsFromUrl(
        'https://example.com/img/token-l1x3lf0-random.png'
      )
    ).toBeNull();
  });

  it('waits for all model discovery before starting and focuses a running report', () => {
    const baseState = {
      token: 100,
      handledToken: null,
      discoveryAttemptedToken: null,
      ready: true,
      targetCount: 0,
      plannedCount: 0,
      canDiscover: true,
      hasRunningSession: false,
    };

    expect(
      resolveImageInspectionAutoRunAction({
        ...baseState,
        discoveryToken: null,
        targetCount: 1,
        plannedCount: 30,
      })
    ).toBe('discover');
    expect(
      resolveImageInspectionAutoRunAction({
        ...baseState,
        discoveryToken: 100,
        discoveryAttemptedToken: 100,
        targetCount: 1,
        plannedCount: 30,
      })
    ).toBe('wait');
    expect(
      resolveImageInspectionAutoRunAction({
        ...baseState,
        discoveryToken: null,
        discoveryAttemptedToken: 100,
        targetCount: 1,
        plannedCount: 30,
        hasRunningSession: true,
      })
    ).toBe('focus-running');
    expect(
      resolveImageInspectionAutoRunAction({
        ...baseState,
        discoveryToken: null,
        discoveryAttemptedToken: null,
        targetCount: 1,
        plannedCount: 30,
        hasRunningSession: true,
      })
    ).toBe('focus-running');
    expect(
      resolveImageInspectionAutoRunAction({
        ...baseState,
        token: 101,
        discoveryToken: null,
        discoveryAttemptedToken: 100,
      })
    ).toBe('discover');
  });

  it('尺寸来源冲突时优先实际图片并严格判定失败', () => {
    const inspectionCase = buildImageInspectionCases([
      {
        profileId: 'gemini',
        profileName: 'gemini 分组',
        model: model('gemini-3-pro-image-preview-4k-vip'),
      },
    ])[0];
    const result = validateImageInspectionDimensionSources(inspectionCase, {
      response: { width: 4096, height: 4096, pixels: 4096 * 4096 },
      natural: { width: 2048, height: 2048, pixels: 2048 * 2048 },
      url: { width: 4096, height: 4096, pixels: 4096 * 4096 },
    });

    expect(result.dimensions).toMatchObject({ width: 2048, height: 2048 });
    expect(result.validation.status).toBe('failed');
    expect(result.validation.message).toContain('尺寸来源冲突');
    expect(result.validation.message).toContain('未达到 4K');
  });

});
