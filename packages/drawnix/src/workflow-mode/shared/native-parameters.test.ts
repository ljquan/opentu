import { describe, expect, it } from 'vitest';
import {
  resolveNativeParameters,
  validateNativeReferences,
} from './native-parameters';

describe('native parameter validation', () => {
  const parameters = [
    {
      id: 'size',
      label: 'Size',
      valueType: 'enum' as const,
      options: [
        { value: '768P', label: '768P' },
        { value: '2K', label: '2K' },
      ],
      defaultValue: '768P',
    },
    {
      id: 'seed',
      label: 'Seed',
      valueType: 'number' as const,
      min: 0,
      max: 10,
      integer: true,
    },
  ];
  it('preserves vendor values and applies defaults', () => {
    expect(resolveNativeParameters(parameters, { seed: 5 })).toEqual({
      size: '768P',
      seed: 5,
    });
  });
  it.each([
    { size: '720p' },
    { seed: '5' },
    { seed: 1.2 },
    { seed: 11 },
    { apiKey: 'secret' },
  ])('rejects invalid values %o', (values) => {
    expect(() => resolveNativeParameters(parameters, values)).toThrow();
  });
  it('applies selected-mode constraints and refuses stale values', () => {
    const parameters = [
      {
        id: 'mode',
        label: 'Mode',
        valueType: 'enum' as const,
        options: [
          { value: 'api', label: 'API' },
          { value: 'web', label: 'Web' },
        ],
        defaultValue: 'web',
      },
      {
        id: 'duration',
        label: 'Duration',
        valueType: 'enum' as const,
        options: [{ value: '10', label: '10' }],
        defaultValue: '10',
        variants: [
          {
            when: { mode: ['api'] },
            options: [{ value: '4', label: '4' }],
            defaultValue: '4',
          },
        ],
      },
    ];
    expect(resolveNativeParameters(parameters, { mode: 'api' })).toEqual({
      mode: 'api',
      duration: '4',
    });
    expect(() =>
      resolveNativeParameters(parameters, { mode: 'api', duration: '10' })
    ).toThrow();
  });
  it('enforces required references and does not silently discard unsupported roles', () => {
    expect(() =>
      validateNativeReferences({ videos: { minCount: 1, maxCount: 1 } }, {})
    ).toThrow();
    expect(() =>
      validateNativeReferences({}, { audios: ['https://example.test/a.mp3'] })
    ).toThrow();
    expect(() =>
      validateNativeReferences(
        { images: { maxCount: 1 } },
        { images: ['a', 'b'] }
      )
    ).toThrow();
  });
});
