import { beforeEach, describe, expect, it, vi } from 'vitest';
import { postprocessGeneratedImage } from './artifact-repair';

const mocks = vi.hoisted(() => ({
  inspect: vi.fn(),
  generateImage: vi.fn(),
  loadImage: vi.fn(),
  cacheBlob: vi.fn(),
}));

vi.mock('./provider', () => ({
  inspectGeneratedImageArtifacts: mocks.inspect,
}));

vi.mock('../media-generation/image-generation-service', () => ({
  generateImage: mocks.generateImage,
}));

vi.mock('../../data/image', () => ({
  loadImageElementForCanvas: mocks.loadImage,
}));

vi.mock('../unified-cache-service', () => ({
  unifiedCacheService: {
    cacheMediaFromBlob: mocks.cacheBlob,
  },
}));

interface DrawCall {
  operation: string;
  source?: string;
}

function installCanvasMock() {
  const contexts: Array<{
    calls: DrawCall[];
    globalCompositeOperation: string;
    fillStyle: string;
  }> = [];
  vi.spyOn(document, 'createElement').mockImplementation(((tagName: string) => {
    if (tagName !== 'canvas') return {} as HTMLElement;
    const context = {
      calls: [] as DrawCall[],
      globalCompositeOperation: 'source-over',
      fillStyle: '',
      drawImage(source: { source?: string }) {
        this.calls.push({
          operation: this.globalCompositeOperation,
          source: source?.source,
        });
      },
      fillRect: vi.fn(),
      clearRect: vi.fn(),
    };
    contexts.push(context);
    return {
      width: 0,
      height: 0,
      source: `canvas-${contexts.length}`,
      getContext: () => context,
      toBlob: (callback: (blob: Blob) => void) =>
        callback(new Blob(['png'], { type: 'image/png' })),
    } as unknown as HTMLCanvasElement;
  }) as typeof document.createElement);
  return contexts;
}

describe('generated image artifact repair', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    mocks.loadImage.mockImplementation(async (url: string) => ({
      source: url,
      naturalWidth: 100,
      naturalHeight: 80,
      width: 100,
      height: 80,
    }));
    mocks.cacheBlob.mockImplementation(async (url: string) => url);
  });

  it('回贴蒙版外原图且低置信度时不触发二次生成', async () => {
    const contexts = installCanvasMock();
    mocks.inspect.mockResolvedValue({
      needsRepair: false,
      boxes: [],
      confidence: 0.4,
    });

    await expect(
      postprocessGeneratedImage({
        generatedImageUrl: '/generated.png',
        originalImageUrl: '/original.png',
        maskImageUrl: '/mask.png',
        taskId: 'task-1',
      })
    ).resolves.toBe(
      '/__aitu_cache__/image/generated-image-mask-protected-task-1.png'
    );

    expect(contexts[0].calls).toEqual([
      { operation: 'source-over', source: '/generated.png' },
      { operation: 'destination-out', source: '/mask.png' },
      { operation: 'destination-over', source: '/original.png' },
    ]);
    expect(mocks.generateImage).not.toHaveBeenCalled();
  });

  it('高置信度局部瑕疵最多触发一次内部蒙版修复', async () => {
    installCanvasMock();
    mocks.inspect
      .mockResolvedValueOnce({
        needsRepair: true,
        boxes: [[250, 100, 450, 350]],
        confidence: 0.94,
        reason: '残留猫尾',
      })
      .mockResolvedValueOnce({
        needsRepair: false,
        boxes: [],
        confidence: 0.96,
      });
    mocks.generateImage.mockResolvedValue({
      task: { id: 'internal-repair' },
      url: '/repair-generated.png',
    });

    await expect(
      postprocessGeneratedImage({
        generatedImageUrl: '/generated.png',
        taskId: 'task-2',
        model: 'gpt-image-2',
        prompt: '保持白兔外观',
        targetName: '白兔',
        excludedTargetName: '猫',
      })
    ).resolves.toBe(
      '/__aitu_cache__/image/generated-image-repaired-task-2.png'
    );

    expect(mocks.generateImage).toHaveBeenCalledTimes(1);
    expect(mocks.generateImage).toHaveBeenCalledWith(
      expect.stringMatching(/局部生成伪影.*原主体“猫”.*尾巴/),
      expect.objectContaining({
        model: 'gpt-image-2',
        generationMode: 'image_edit',
        inputFidelity: 'high',
        resultVisibility: 'internal',
        autoInsertToCanvas: false,
        referenceImages: ['/generated.png'],
        maskImage:
          '/__aitu_cache__/image/generated-image-repair-mask-task-2.png',
      })
    );
    expect(mocks.inspect).toHaveBeenCalledTimes(2);
  });

  it('主体替换复检仍有旧主体残留时拒绝产物', async () => {
    installCanvasMock();
    mocks.inspect.mockResolvedValue({
      needsRepair: true,
      boxes: [[250, 100, 450, 350]],
      confidence: 0.94,
      reason: '残留猫尾',
    });
    mocks.generateImage.mockResolvedValue({
      task: { id: 'internal-repair' },
      url: '/repair-generated.png',
    });

    await expect(
      postprocessGeneratedImage({
        generatedImageUrl: '/generated.png',
        taskId: 'task-residual',
        prompt: '把猫替换成兔子',
        excludedTargetName: '猫',
      })
    ).rejects.toThrow('仍检测到旧主体残留');

    expect(mocks.generateImage).toHaveBeenCalledTimes(1);
    expect(mocks.inspect).toHaveBeenCalledTimes(2);
  });

  it('主体替换无法检查旧主体残留时拒绝覆盖', async () => {
    mocks.inspect.mockResolvedValue(undefined);

    await expect(
      postprocessGeneratedImage({
        generatedImageUrl: '/generated.png',
        taskId: 'task-unverified',
        excludedTargetName: '猫',
      })
    ).rejects.toThrow('残留检查不可用');

    expect(mocks.generateImage).not.toHaveBeenCalled();
  });

  it('检测到旧主体残留但没有修复框时拒绝覆盖', async () => {
    mocks.inspect.mockResolvedValue({
      needsRepair: true,
      boxes: [],
      confidence: 0.91,
      reason: '仍可见猫尾但无法给出可靠边界',
    });

    await expect(
      postprocessGeneratedImage({
        generatedImageUrl: '/generated.png',
        taskId: 'task-missing-box',
        excludedTargetName: '猫',
      })
    ).rejects.toThrow('缺少修复区域');

    expect(mocks.generateImage).not.toHaveBeenCalled();
  });

  it('视觉检查不可用时保持现有结果', async () => {
    mocks.inspect.mockResolvedValue(undefined);
    await expect(
      postprocessGeneratedImage({
        generatedImageUrl: '/generated.png',
        taskId: 'task-3',
      })
    ).resolves.toBe('/generated.png');
    expect(mocks.generateImage).not.toHaveBeenCalled();
  });
});
