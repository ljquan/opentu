import { describe, expect, it } from 'vitest';
import { mapModelDefaults } from './model-defaults';
import { isModelDefaults, sameConfig } from '../shared/model-defaults';
import type {
  ProviderProfile,
  ResolvedInvocationRoute,
} from '../../utils/settings-types';

const profile: ProviderProfile = {
  id: 'p1',
  name: 'Test',
  enabled: true,
  baseUrl: 'https://example.test/v1',
  apiKey: 'synthetic-test-key',
  authType: 'bearer',
  providerType: 'openai-compatible',
  capabilities: {
    supportsText: true,
    supportsImage: true,
    supportsVideo: true,
    supportsAudio: true,
    supportsTools: false,
    supportsModelsEndpoint: true,
  },
};
const route: ResolvedInvocationRoute = {
  routeType: 'image',
  modelId: 'gpt-image-2',
  profileId: 'p1',
  profileName: 'Test',
  providerType: 'openai-compatible',
  baseUrl: profile.baseUrl,
  apiKey: profile.apiKey,
  source: 'preset',
};
describe('OpenTu workflow model defaults', () => {
  it('keeps channel identity, URL and model capability', () => {
    const result = mapModelDefaults([profile], [], [route], []);
    expect(result.defaults.image).toBe('opentu-p1::gpt-image-2');
    expect(result.channels[0].baseUrl).toBe('https://example.test/v1');
    expect(result.channels[0].models).toEqual([
      { name: 'gpt-image-2', capability: 'image' },
    ]);
    expect(isModelDefaults(result)).toBe(true);
  });
  it('excludes disabled channels and unsupported authentication', () => {
    expect(
      mapModelDefaults([{ ...profile, enabled: false }], [], [route], [])
        .channels
    ).toEqual([]);
    const result = mapModelDefaults(
      [{ ...profile, extraHeaders: { test: 'value' } }],
      [],
      [route],
      []
    );
    expect(result.channels).toEqual([]);
    expect(result.warnings).toHaveLength(1);
  });
  it('does not pretend special image protocols or unknown video protocols work', () => {
    expect(
      mapModelDefaults(
        [{ ...profile, imageApiCompatibility: 'tuzi-gpt-image' }],
        [],
        [route],
        []
      ).channels
    ).toEqual([]);
    expect(
      mapModelDefaults(
        [profile],
        [],
        [{ ...route, routeType: 'video', modelId: 'kling' }],
        []
      ).warnings
    ).toHaveLength(1);
  });
  it('imports missing credentials without inventing a key', () => {
    expect(
      mapModelDefaults([{ ...profile, apiKey: '' }], [], [route], [])
        .channels[0].apiKey
    ).toBe('');
  });
  it('preserves distinct channels with the same model', () => {
    const result = mapModelDefaults(
      [profile, { ...profile, id: 'p2' }],
      [],
      [route, { ...route, profileId: 'p2' }],
      []
    );
    expect(result.channels.map((channel) => channel.id)).toEqual([
      'opentu-p1',
      'opentu-p2',
    ]);
  });
  it('rejects malformed payloads and executable scripts', () => {
    expect(isModelDefaults({ channels: [{}] })).toBe(false);
    const result = mapModelDefaults([profile], [], [route], []);
    result.channels[0].models[0].script = 'unexpected';
    expect(isModelDefaults(result)).toBe(false);
  });
  it('matches defaults despite key order but detects user edits', () => {
    expect(
      sameConfig(
        { name: 'x', script: undefined, models: ['a'] },
        { models: ['a'], name: 'x' }
      )
    ).toBe(true);
    expect(sameConfig({ name: 'x' }, { name: 'custom' })).toBe(false);
    expect(sameConfig({ models: ['a'] }, { models: ['b'] })).toBe(false);
  });
});
