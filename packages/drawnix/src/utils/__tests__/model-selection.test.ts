import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelVendor, type ModelConfig } from '../../constants/model-config';
import {
  resolveActiveImageModelSelection,
  resolveImageSubmissionModelSelection,
} from '../model-selection';

const resolveInvocationRouteMock = vi.fn();

vi.mock('../settings-manager', () => ({
  createModelRef: (profileId?: string | null, modelId?: string | null) => {
    const normalizedProfileId =
      typeof profileId === 'string' && profileId.trim()
        ? profileId.trim()
        : null;
    const normalizedModelId =
      typeof modelId === 'string' && modelId.trim() ? modelId.trim() : null;
    if (!normalizedProfileId && !normalizedModelId) {
      return null;
    }
    return { profileId: normalizedProfileId, modelId: normalizedModelId };
  },
  resolveInvocationRoute: (...args: unknown[]) =>
    resolveInvocationRouteMock(...args),
}));

describe('model-selection', () => {
  beforeEach(() => {
    resolveInvocationRouteMock.mockReturnValue({
      routeType: 'image',
      modelId: 'gpt-image-2',
      profileId: 'provider-custom',
      profileName: 'Custom Provider',
      providerType: 'custom',
      baseUrl: 'https://api.example.test/v1',
      apiKey: 'key',
      source: 'preset',
    });
  });

  const customImageModel: ModelConfig = {
    id: 'gpt-image-2',
    label: 'GPT Image 2',
    shortLabel: 'GPT Image 2',
    type: 'image',
    vendor: ModelVendor.GPT,
    sourceProfileId: 'provider-custom',
    sourceProfileName: 'Custom Provider',
    selectionKey: 'provider-custom::gpt-image-2',
  };

  const legacyImageModel: ModelConfig = {
    id: 'image2',
    label: 'image2',
    shortLabel: 'image2',
    type: 'image',
    vendor: ModelVendor.OTHER,
  };

  const manualImage2Model: ModelConfig = {
    id: 'image-2',
    label: 'image-2',
    shortLabel: 'image-2',
    type: 'image',
    vendor: ModelVendor.OTHER,
    sourceProfileId: 'provider-custom',
    sourceProfileName: 'Custom Provider',
    selectionKey: 'provider-custom::image-2',
    tags: ['runtime', 'manual'],
  };

  it('submits the active custom route when stale UI state still points to image2', () => {
    const activeSelection = resolveActiveImageModelSelection([
      customImageModel,
      legacyImageModel,
    ]);

    const submissionSelection = resolveImageSubmissionModelSelection({
      models: [customImageModel, legacyImageModel],
      currentModel: 'image2',
      currentModelRef: null,
      activeSelection,
    });

    expect(submissionSelection).toMatchObject({
      modelId: 'gpt-image-2',
      modelRef: {
        profileId: 'provider-custom',
        modelId: 'gpt-image-2',
      },
      selectionKey: 'provider-custom::gpt-image-2',
    });
  });

  it('preserves an explicit profile-scoped current selection', () => {
    const submissionSelection = resolveImageSubmissionModelSelection({
      models: [customImageModel, legacyImageModel],
      currentModel: 'gpt-image-2',
      currentModelRef: {
        profileId: 'provider-custom',
        modelId: 'gpt-image-2',
      },
      controlledModel: 'image2',
      controlledModelRef: null,
      activeSelection: resolveActiveImageModelSelection([
        customImageModel,
        legacyImageModel,
      ]),
    });

    expect(submissionSelection.selectionKey).toBe(
      'provider-custom::gpt-image-2'
    );
  });

  it('promotes an unscoped current model to a matching manual provider model', () => {
    resolveInvocationRouteMock.mockReturnValue({
      routeType: 'image',
      modelId: 'image-2',
      profileId: null,
      profileName: null,
      providerType: null,
      baseUrl: 'https://api.example.test/v1',
      apiKey: 'key',
      source: 'legacy',
    });

    const submissionSelection = resolveImageSubmissionModelSelection({
      models: [manualImage2Model],
      currentModel: 'image-2',
      currentModelRef: null,
      controlledModel: 'image-2',
      controlledModelRef: null,
      activeSelection: resolveActiveImageModelSelection([manualImage2Model]),
    });

    expect(submissionSelection).toMatchObject({
      modelId: 'image-2',
      modelRef: {
        profileId: 'provider-custom',
        modelId: 'image-2',
      },
      selectionKey: 'provider-custom::image-2',
    });
  });

  it('prefers a manual provider model over an unscoped static model with the same id', () => {
    const staticImage2Model: ModelConfig = {
      id: 'image-2',
      label: 'image-2',
      shortLabel: 'image-2',
      type: 'image',
      vendor: ModelVendor.OTHER,
    };
    resolveInvocationRouteMock.mockReturnValue({
      routeType: 'image',
      modelId: 'image-2',
      profileId: null,
      profileName: null,
      providerType: null,
      baseUrl: 'https://api.example.test/v1',
      apiKey: 'key',
      source: 'legacy',
    });

    const submissionSelection = resolveImageSubmissionModelSelection({
      models: [staticImage2Model, manualImage2Model],
      currentModel: 'image-2',
      currentModelRef: null,
      controlledModel: 'image-2',
      controlledModelRef: null,
      activeSelection: resolveActiveImageModelSelection([
        staticImage2Model,
        manualImage2Model,
      ]),
    });

    expect(submissionSelection).toMatchObject({
      modelId: 'image-2',
      modelRef: {
        profileId: 'provider-custom',
        modelId: 'image-2',
      },
      selectionKey: 'provider-custom::image-2',
    });
  });

  it('promotes stale unscoped image-2 to the only manual image model', () => {
    const manualGptImageModel: ModelConfig = {
      ...customImageModel,
      tags: ['runtime', 'manual'],
    };
    resolveInvocationRouteMock.mockReturnValue({
      routeType: 'image',
      modelId: 'image-2',
      profileId: null,
      profileName: null,
      providerType: null,
      baseUrl: 'https://api.example.test/v1',
      apiKey: 'key',
      source: 'legacy',
    });

    const activeSelection = resolveActiveImageModelSelection([
      manualGptImageModel,
    ]);
    const submissionSelection = resolveImageSubmissionModelSelection({
      models: [manualGptImageModel],
      currentModel: 'image-2',
      currentModelRef: null,
      controlledModel: 'image-2',
      controlledModelRef: null,
      activeSelection,
    });

    expect(submissionSelection).toMatchObject({
      modelId: 'gpt-image-2',
      modelRef: {
        profileId: 'provider-custom',
        modelId: 'gpt-image-2',
      },
      selectionKey: 'provider-custom::gpt-image-2',
    });
  });

  it('repairs a fully scoped stale image2 route with the latest manual model', () => {
    const manualGeminiModel: ModelConfig = {
      id: 'gemini',
      label: 'gemini',
      shortLabel: 'gemini',
      type: 'image',
      vendor: ModelVendor.GEMINI,
      sourceProfileId: 'provider-custom',
      sourceProfileName: 'Custom Provider',
      selectionKey: 'provider-custom::gemini',
      tags: ['runtime', 'manual'],
    };
    resolveInvocationRouteMock.mockReturnValue({
      routeType: 'image',
      modelId: 'image-2',
      profileId: 'provider-custom',
      profileName: 'Custom Provider',
      providerType: 'custom',
      baseUrl: 'https://api.example.test/v1',
      apiKey: 'key',
      source: 'preset',
    });

    const activeSelection = resolveActiveImageModelSelection([
      legacyImageModel,
      manualGeminiModel,
    ]);
    const submissionSelection = resolveImageSubmissionModelSelection({
      models: [legacyImageModel, manualGeminiModel],
      currentModel: 'image2',
      currentModelRef: {
        profileId: 'provider-custom',
        modelId: 'image2',
      },
      controlledModel: 'image-2',
      controlledModelRef: {
        profileId: 'provider-custom',
        modelId: 'image-2',
      },
      activeSelection,
    });

    expect(submissionSelection).toMatchObject({
      modelId: 'gemini',
      modelRef: {
        profileId: 'provider-custom',
        modelId: 'gemini',
      },
      selectionKey: 'provider-custom::gemini',
    });
  });

  it('prefers a newly selected manual model over a stale image2 model ref', () => {
    const manualGeminiModel: ModelConfig = {
      id: 'gemini',
      label: 'gemini',
      shortLabel: 'gemini',
      type: 'image',
      vendor: ModelVendor.GEMINI,
      sourceProfileId: 'provider-custom',
      sourceProfileName: 'Custom Provider',
      selectionKey: 'provider-custom::gemini',
      tags: ['runtime', 'manual'],
    };

    const submissionSelection = resolveImageSubmissionModelSelection({
      models: [legacyImageModel, manualGeminiModel],
      currentModel: 'gemini',
      currentModelRef: {
        profileId: 'provider-custom',
        modelId: 'image2',
      },
      controlledModel: 'gemini',
      controlledModelRef: {
        profileId: 'provider-custom',
        modelId: 'image2',
      },
      activeSelection: resolveActiveImageModelSelection([
        legacyImageModel,
        manualGeminiModel,
      ]),
    });

    expect(submissionSelection).toMatchObject({
      modelId: 'gemini',
      modelRef: {
        profileId: 'provider-custom',
        modelId: 'gemini',
      },
    });
  });
});
