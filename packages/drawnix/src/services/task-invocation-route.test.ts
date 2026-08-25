import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  assertTaskInvocationRouteAvailable,
  createTaskInvocationRouteSnapshot,
} from './task-invocation-route';

const mocks = vi.hoisted(() => ({
  createModelRef: vi.fn((profileId: string | null, modelId: string | null) =>
    profileId || modelId ? { profileId, modelId } : null
  ),
  getProviderProfiles: vi.fn(),
  resolveInvocationRoute: vi.fn(),
  resolveInvocationPlanFromRoute: vi.fn(),
}));

vi.mock('../utils/settings-manager', () => ({
  createModelRef: mocks.createModelRef,
  providerProfilesSettings: { get: mocks.getProviderProfiles },
  resolveInvocationRoute: mocks.resolveInvocationRoute,
}));

vi.mock('./provider-routing', () => ({
  resolveInvocationPlanFromRoute: mocks.resolveInvocationPlanFromRoute,
}));

function createPlan(binding: Record<string, unknown>) {
  return {
    provider: {
      profileId: 'profile-1',
      providerType: 'custom',
    },
    modelRef: {
      profileId: 'profile-1',
      modelId: 'model-1',
    },
    binding,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getProviderProfiles.mockReturnValue([
    {
      id: 'profile-1',
      enabled: true,
      apiKey: 'runtime-only-key',
      baseUrl: 'https://provider.example',
    },
  ]);
});

describe('task invocation route snapshots', () => {
  it('persists only known capability metadata without credentials or HTTP templates', () => {
    mocks.resolveInvocationPlanFromRoute.mockReturnValue(
      createPlan({
        id: 'binding-1',
        protocol: 'custom.image',
        requestSchema: 'custom.image.v1',
        responseSchema: 'custom.task.v1',
        submitPath: '/images',
        metadata: {
          text: {
            supportsImageInput: true,
            maxImageCount: 4,
            authorization: 'Bearer nested-secret',
          },
          image: {
            action: 'generation',
            supportsMask: false,
          },
          video: {
            allowedDurations: ['5', '10'],
            durationToModelMap: { '5': 'video-five' },
            versionOptionsByAction: { text2video: ['v1', 'v2'] },
          },
          manualHttp: {
            headers: {
              Authorization: 'Bearer header-secret',
              'X-API-Key': 'header-api-key',
              Cookie: 'session=cookie-secret',
            },
            bodyTemplate:
              '{"access_token":"body-token","secret":"body-secret"}',
            formFields: [{ name: 'api_key', value: 'form-secret' }],
          },
          accessToken: 'top-level-token',
          custom: { secret: 'custom-secret' },
        },
      })
    );

    const snapshot = createTaskInvocationRouteSnapshot(
      'image',
      {
        profileId: 'profile-1',
        modelId: 'model-1',
      },
      {
        metadataPolicy: 'capabilities-only',
      }
    );

    expect(snapshot.binding?.metadata).toEqual({
      text: {
        supportsImageInput: true,
        maxImageCount: 4,
      },
      image: {
        action: 'generation',
        supportsMask: false,
      },
      video: {
        allowedDurations: ['5', '10'],
        durationToModelMap: { '5': 'video-five' },
        versionOptionsByAction: { text2video: ['v1', 'v2'] },
      },
    });
    const serialized = JSON.stringify(snapshot);
    for (const secret of [
      'nested-secret',
      'header-secret',
      'header-api-key',
      'cookie-secret',
      'body-token',
      'body-secret',
      'form-secret',
      'top-level-token',
      'custom-secret',
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it('fails closed when a restored route would select a different binding', () => {
    const originalPlan = createPlan({ id: 'binding-original' });
    const changedPlan = createPlan({ id: 'binding-new-priority' });
    mocks.resolveInvocationPlanFromRoute.mockImplementation(
      (_operation, _modelRef, options?: { bindingId?: string }) =>
        options?.bindingId === 'binding-original' ? originalPlan : changedPlan
    );

    expect(() =>
      assertTaskInvocationRouteAvailable(
        'text',
        {
          invocationRoute: {
            operation: 'text',
            providerProfileId: 'profile-1',
            modelRef: { profileId: 'profile-1', modelId: 'model-1' },
            binding: { id: 'binding-original' },
          },
        },
        { requireSelectedBindingMatch: true }
      )
    ).toThrow('原供应商模型绑定已发生变化');
    expect(mocks.resolveInvocationPlanFromRoute).toHaveBeenCalledWith(
      'text',
      { profileId: 'profile-1', modelId: 'model-1' },
      { bindingId: 'binding-original' }
    );
  });
});
