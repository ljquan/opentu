import { describe, expect, it } from 'vitest';
import {
  normalizeEndpointApiBaseUrl,
  normalizeEndpointUrl,
  resolveEndpointSelectionUrl,
} from '../provider-endpoint-utils';

describe('provider endpoint utils', () => {
  it('keeps endpoint cards on origins while storing versioned API bases', () => {
    expect(normalizeEndpointUrl('https://apius.tu-zi.com/')).toBe(
      'https://apius.tu-zi.com'
    );
    expect(normalizeEndpointApiBaseUrl('https://apius.tu-zi.com')).toBe(
      'https://apius.tu-zi.com/v1'
    );
    expect(normalizeEndpointApiBaseUrl('https://apius.tu-zi.com/v1')).toBe(
      'https://apius.tu-zi.com/v1'
    );
  });

  it('maps a saved /v1 base URL back to the matching endpoint card', () => {
    expect(
      resolveEndpointSelectionUrl('https://apicdn.tu-zi.com/v1', [
        'https://api.tu-zi.com',
        'https://apius.tu-zi.com',
        'https://apicdn.tu-zi.com',
      ])
    ).toBe('https://apicdn.tu-zi.com');
  });

  it('preserves custom path prefixes when normalizing endpoint bases', () => {
    expect(
      normalizeEndpointApiBaseUrl('https://gateway.example.com/openai')
    ).toBe('https://gateway.example.com/openai/v1');
    expect(
      resolveEndpointSelectionUrl('https://gateway.example.com/openai/v1', [
        'https://gateway.example.com/openai',
      ])
    ).toBe('https://gateway.example.com/openai');
  });
});
