import { describe, expect, it } from 'vitest';

import {
  buildHealthMap,
  buildModelHealthKey,
  matchModelHealth,
  parseHealthGroupName,
  shouldFetchModelHealthForSelections,
  isTuziApiUrl,
  type ModelHealthResponse,
} from '../model-health-service';

describe('model-health-service', () => {
  const healthData: ModelHealthResponse[] = [
    {
      rule_id: '1',
      rule_name: 'gpt-image-2',
      model_name: 'gpt-image-2',
      time_bucket: 200,
      detect_saturated: false,
      error_rate: 5,
      status_label: '正常',
      status_color: '#10B981',
      is_low_traffic: false,
      total_count: 100,
      error_count: 5,
      avg_response_time: 100,
      min_response_time: 90,
      max_response_time: 120,
      upstream_error_rate: 0,
    },
    {
      rule_id: '2',
      rule_name: 'gpt-image-2 | codex',
      model_name: 'gpt-image-2',
      time_bucket: 210,
      detect_saturated: true,
      error_rate: 65,
      status_label: '拥挤',
      status_color: '#EF4444',
      is_low_traffic: false,
      total_count: 80,
      error_count: 52,
      avg_response_time: 150,
      min_response_time: 120,
      max_response_time: 180,
      upstream_error_rate: 10,
    },
  ];

  it('parses rule group names from aggregated response', () => {
    expect(parseHealthGroupName('gpt-image-2')).toBe('default');
    expect(parseHealthGroupName('gpt-image-2 | codex')).toBe('codex');
  });

  it('stores health status by model plus group', () => {
    const map = buildHealthMap(healthData);

    expect(map.get(buildModelHealthKey('gpt-image-2', 'default'))).toMatchObject({
      ruleName: 'gpt-image-2',
      groupName: 'default',
      statusLabel: '正常',
    });
    expect(map.get(buildModelHealthKey('gpt-image-2', 'codex'))).toMatchObject({
      ruleName: 'gpt-image-2 | codex',
      groupName: 'codex',
      statusLabel: '拥挤',
    });
  });

  it('matches the requested group without falling back to default', () => {
    expect(matchModelHealth('gpt-image-2', healthData, 'default')?.ruleName).toBe(
      'gpt-image-2'
    );
    expect(matchModelHealth('gpt-image-2', healthData, 'codex')?.ruleName).toBe(
      'gpt-image-2 | codex'
    );
  });

  it('detects Tuzi primary and trusted alternate hostnames', () => {
    expect(isTuziApiUrl('https://api.tu-zi.com/v1')).toBe(true);
    expect(isTuziApiUrl('apistatus.tu-zi.com/api')).toBe(true);
    expect(isTuziApiUrl('https://api.sydney-ai.com/v1')).toBe(true);
    expect(isTuziApiUrl('https://api.ourzhishi.top/v1')).toBe(true);
    expect(isTuziApiUrl('https://not-tu-zi.com/v1')).toBe(false);
  });

  it('does not fetch health when selected models use non-Tuzi providers', () => {
    const providers = [
      {
        id: 'tuzi-idle',
        baseUrl: 'https://api.tu-zi.com/v1',
        enabled: true,
      },
      {
        id: 'openai-active',
        baseUrl: 'https://api.openai.com/v1',
        enabled: true,
      },
    ];

    expect(
      shouldFetchModelHealthForSelections(
        [{ modelId: 'gpt-image-2', profileId: 'openai-active' }],
        providers,
        'https://api.openai.com/v1'
      )
    ).toBe(false);
  });

  it('fetches health when any selected model uses a tu-zi.com provider', () => {
    const providers = [
      {
        id: 'tuzi-active',
        baseUrl: 'https://api.tu-zi.com/v1',
        enabled: true,
      },
      {
        id: 'custom-active',
        baseUrl: 'https://gateway.example.com/v1',
        enabled: true,
      },
    ];

    expect(
      shouldFetchModelHealthForSelections(
        [
          { modelId: 'custom-model', profileId: 'custom-active' },
          { modelId: 'gpt-image-2', profileId: 'tuzi-active' },
        ],
        providers,
        'https://gateway.example.com/v1'
      )
    ).toBe(true);
  });
});
