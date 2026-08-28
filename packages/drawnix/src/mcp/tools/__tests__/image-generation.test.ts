import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createQueueTask: vi.fn(),
  resolveAdapterForInvocation: vi.fn(),
  getAdapterContextFromSettings: vi.fn(),
  generateImage: vi.fn(),
}));

vi.mock('../../../constants/model-config', () => ({
  getDefaultImageModel: () => 'gpt-image-2',
  IMAGE_PARAMS: [
    {
      id: 'size',
      options: [
        { value: '1x1', label: '1:1' },
        { value: '16x9', label: '16:9' },
        { value: '9x16', label: '9:16' },
      ],
    },
  ],
}));

vi.mock('../../../utils/settings-manager', () => ({
  geminiSettings: {
    get: () => ({}),
  },
}));

vi.mock('../../../services/media-api/utils', () => ({
  normalizeToClosestImageSize: (size: string) => size,
}));

vi.mock('../../../services/model-adapters', () => ({
  resolveAdapterForInvocation: mocks.resolveAdapterForInvocation,
  getAdapterContextFromSettings: mocks.getAdapterContextFromSettings,
  GPT_IMAGE_EDIT_REQUEST_SCHEMAS: [
    'openai.image.gpt-edit-form',
    'tuzi.image.gpt-edit-json',
  ],
  isGPTImageEditRequestSchema: (value?: string | string[] | null) => {
    const schemas = Array.isArray(value) ? value : value ? [value] : [];
    return schemas.some(
      (schema) =>
        schema === 'openai.image.gpt-edit-form' ||
        schema === 'tuzi.image.gpt-edit-json'
    );
  },
}));

vi.mock('../shared/queue-utils', () => ({
  createQueueTask: mocks.createQueueTask,
  validatePrompt: (prompt: unknown) =>
    !prompt || typeof prompt !== 'string'
      ? { success: false, error: '缺少必填参数 prompt', type: 'error' }
      : null,
  wrapApiError: (error: any, fallbackMessage: string) => ({
    success: false,
    error: error?.message || fallbackMessage,
    type: 'error',
  }),
  toUploadedImages: (referenceImages?: string[]) =>
    referenceImages?.map((url, index) => ({
      type: 'url' as const,
      url,
      name: `reference-${index + 1}`,
    })),
}));

import { imageGenerationTool } from '../image-generation';

describe('image-generation MCP tool', () => {
  beforeEach(() => {
    mocks.createQueueTask.mockReset();
    mocks.resolveAdapterForInvocation.mockReset();
    mocks.getAdapterContextFromSettings.mockReset();
    mocks.generateImage.mockReset();

    mocks.getAdapterContextFromSettings.mockReturnValue({
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'test-key',
      authType: 'bearer',
    });
  });

  it('routes async generation through the selected image adapter', async () => {
    mocks.resolveAdapterForInvocation.mockReturnValue({
      id: 'gpt-image-adapter',
      kind: 'image',
      generateImage: mocks.generateImage,
    });
    mocks.generateImage.mockResolvedValue({
      url: 'https://example.com/output.webp',
      urls: [
        'https://example.com/output.webp',
        'https://example.com/output-2.webp',
      ],
      format: 'webp',
    });

    const result = await imageGenerationTool.execute(
      {
        prompt: 'Create an edited image',
        model: 'gpt-image-2',
        size: '16x9',
        resolution: '2k',
        quality: 'high',
        referenceImages: ['https://example.com/input.png'],
        generationMode: 'image_edit',
        maskImage: 'https://example.com/mask.png',
        inputFidelity: 'high',
        background: 'transparent',
        outputFormat: 'png',
        outputCompression: 80,
        count: 3,
      },
      { mode: 'async', retryTaskId: 'workflow-image-request-1' }
    );

    expect(mocks.resolveAdapterForInvocation).toHaveBeenCalledWith(
      'image',
      'gpt-image-2',
      null,
      {
        preferredRequestSchema: [
          'openai.image.gpt-edit-form',
          'tuzi.image.gpt-edit-json',
        ],
      }
    );
    expect(mocks.getAdapterContextFromSettings).toHaveBeenCalledWith(
      'image',
      'gpt-image-2',
      {
        preferredRequestSchema: [
          'openai.image.gpt-edit-form',
          'tuzi.image.gpt-edit-json',
        ],
      }
    );
    expect(mocks.generateImage).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: 'https://api.openai.com/v1',
        requestId: 'workflow-image-request-1',
      }),
      expect.objectContaining({
        prompt: 'Create an edited image',
        model: 'gpt-image-2',
        size: '16x9',
        generationMode: 'image_edit',
        referenceImages: ['https://example.com/input.png'],
        maskImage: 'https://example.com/mask.png',
        inputFidelity: 'high',
        background: 'transparent',
        outputFormat: 'png',
        outputCompression: 80,
        params: {
          resolution: '2k',
          quality: 'high',
          n: 3,
        },
      })
    );
    expect(result).toEqual({
      success: true,
      data: {
        url: 'https://example.com/output.webp',
        urls: [
          'https://example.com/output.webp',
          'https://example.com/output-2.webp',
        ],
        format: 'webp',
        prompt: 'Create an edited image',
        size: '16x9',
      },
      type: 'image',
    });
  });

  it('passes top-level quality and resolution into queue task params', async () => {
    mocks.createQueueTask.mockReturnValue({
      success: true,
      type: 'image',
      taskId: 'task-1',
    });

    await imageGenerationTool.execute(
      {
        prompt: 'Queue this image',
        model: 'gpt-image-2',
        size: '1x1',
        resolution: '4k',
        quality: 'high',
        params: {
          foo: 'bar',
        },
      },
      { mode: 'queue' }
    );

    expect(mocks.createQueueTask).toHaveBeenCalledTimes(1);
    const queueConfig = mocks.createQueueTask.mock.calls[0]?.[2];

    expect(queueConfig.buildTaskPayload()).toMatchObject({
      prompt: 'Queue this image',
      size: '1x1',
      model: 'gpt-image-2',
      params: {
        foo: 'bar',
        resolution: '4k',
        quality: 'high',
      },
    });
  });

  it('does not pass top-level count as adapter n in queue task params', async () => {
    mocks.createQueueTask.mockReturnValue({
      success: true,
      type: 'image',
      taskId: 'task-1',
    });

    await imageGenerationTool.execute(
      {
        prompt: 'Queue two image tasks',
        model: 'gpt-image-2',
        count: 2,
        params: {
          foo: 'bar',
        },
      },
      { mode: 'queue' }
    );

    const queueConfig = mocks.createQueueTask.mock.calls[0]?.[2];

    expect(queueConfig.buildTaskPayload()).toMatchObject({
      prompt: 'Queue two image tasks',
      params: {
        foo: 'bar',
      },
    });
    expect(queueConfig.buildTaskPayload().params).not.toHaveProperty('n');
    expect(queueConfig.buildTaskPayload().params).not.toHaveProperty('count');
  });

  it('passes PPT slide replacement metadata into queue task params', async () => {
    mocks.createQueueTask.mockReturnValue({
      success: true,
      type: 'image',
      taskId: 'task-1',
    });

    await imageGenerationTool.execute(
      {
        prompt: 'Regenerate a PPT slide',
        model: 'gpt-image-2',
        size: '16x9',
        autoInsertToCanvas: true,
        targetFrameId: 'frame-1',
        targetFrameDimensions: { width: 1920, height: 1080 },
        pptSlideImage: true,
        pptReplaceElementId: 'old-image',
      },
      { mode: 'queue' }
    );

    const queueConfig = mocks.createQueueTask.mock.calls[0]?.[2];

    expect(queueConfig.buildTaskPayload()).toMatchObject({
      prompt: 'Regenerate a PPT slide',
      size: '16x9',
      targetFrameId: 'frame-1',
      targetFrameDimensions: { width: 1920, height: 1080 },
      pptSlideImage: true,
      pptReplaceElementId: 'old-image',
    });
  });

  it('passes taskbar follow control metadata into queue task params', async () => {
    mocks.createQueueTask.mockReturnValue({
      success: true,
      type: 'image',
      taskId: 'task-1',
    });

    await imageGenerationTool.execute(
      {
        prompt: 'Generate a new target variant',
        replaceElementId: 'image-target',
        targetElementId: 'image-target',
        boundTargetFollowControlled: true,
      },
      { mode: 'queue' }
    );

    const queueConfig = mocks.createQueueTask.mock.calls[0]?.[2];

    expect(queueConfig.buildTaskPayload()).toMatchObject({
      prompt: 'Generate a new target variant',
      replaceElementId: 'image-target',
      targetElementId: 'image-target',
      boundTargetFollowControlled: true,
    });
  });
});
