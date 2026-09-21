import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getDrawerGenerationRouteType,
  resolveDrawerGenerationRoute,
} from '../drawer-generation-route';

const resolveInvocationRouteMock = vi.hoisted(() => vi.fn());

vi.mock('../../../utils/settings-manager', () => ({
  resolveInvocationRoute: resolveInvocationRouteMock,
}));

const baseParams = {
  prompt: 'test',
  selectedContent: [],
  selectedModel: 'model-id',
  selectedModelRef: { profileId: 'profile-id', modelId: 'model-id' },
  selectedParams: {},
  selectedCount: 1,
  targetSessionId: 'session-id',
} as const;

beforeEach(() => {
  resolveInvocationRouteMock.mockReset();
  resolveInvocationRouteMock.mockReturnValue({ apiKey: '' });
});

describe('drawer generation route', () => {
  it.each([
    ['image', 'image'],
    ['video', 'video'],
    ['audio', 'audio'],
    ['text', 'text'],
    ['agent', 'text'],
  ] as const)(
    'maps %s generation to the %s route',
    (generationType, routeType) => {
      expect(getDrawerGenerationRouteType(generationType)).toBe(routeType);
    }
  );

  it('checks the selected image model instead of the text route', () => {
    resolveDrawerGenerationRoute({
      ...baseParams,
      generationType: 'image',
    });

    expect(resolveInvocationRouteMock).toHaveBeenCalledWith(
      'image',
      baseParams.selectedModelRef
    );
  });
});
