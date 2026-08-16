import { describe, expect, it } from 'vitest';
import {
  getTuziUrlApiKeyFromHref,
  isTuziUrlTokenMode,
} from '../provider-routing/tuzi-url-token';

const token = 'sk-tuzi-runtime-token';

describe('tuzi URL token bridge', () => {
  it('reads the dedicated query parameter', () => {
    expect(
      getTuziUrlApiKeyFromHref(
        `https://opentu.example.com/?tuzi_api_key=${token}`
      )
    ).toBe(token);
  });

  it('reads the dedicated hash parameter', () => {
    expect(
      getTuziUrlApiKeyFromHref(
        `https://opentu.example.com/#tuzi_api_key=${token}`
      )
    ).toBe(token);
  });

  it('does not treat the existing apiKey import parameter as runtime mode', () => {
    expect(
      getTuziUrlApiKeyFromHref(`https://opentu.example.com/?apiKey=${token}`)
    ).toBe('');
  });

  it('rejects values that are not model API tokens', () => {
    expect(
      getTuziUrlApiKeyFromHref(
        'https://opentu.example.com/?tuzi_api_key=not-a-model-token'
      )
    ).toBe('');
    expect(isTuziUrlTokenMode('https://opentu.example.com/')).toBe(false);
  });

  it('recognizes URL-token mode only when a valid token is present', () => {
    expect(
      isTuziUrlTokenMode(`https://opentu.example.com/#tuzi_api_key=${token}`)
    ).toBe(true);
  });
});
