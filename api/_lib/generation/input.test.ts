import { describe, expect, it } from 'vitest';
import { generationRequestHash, parseCreateRequest } from './input';

describe('generation request validation', () => {
  it('normalizes supported text input and produces stable hashes', () => {
    const first = parseCreateRequest({
      modelId: 'text-model',
      operation: 'text',
      input: { prompt: '  hello  ' },
      parameters: { maxTokens: 100 },
    });
    const second = parseCreateRequest({
      parameters: { maxTokens: 100 },
      input: { prompt: 'hello' },
      operation: 'text',
      modelId: 'text-model',
    });
    expect(first.input).toEqual({ prompt: 'hello' });
    expect(generationRequestHash(first)).toBe(generationRequestHash(second));
  });

  it('rejects provider routing overrides at any nested level', () => {
    expect(() =>
      parseCreateRequest({
        modelId: 'text-model',
        operation: 'text',
        input: { prompt: 'hello', options: { baseUrl: 'https://evil.invalid' } },
      })
    ).toThrow(/不能指定供应商地址/);
  });

  it('rejects inline references outside the bounded image formats', () => {
    expect(() =>
      parseCreateRequest({
        modelId: 'image-model',
        operation: 'image',
        input: { prompt: 'hello', images: ['https://example.com/image.png'] },
      })
    ).toThrow(/仅支持小型/);
  });

  it('keeps video and audio behind the next migration boundary', () => {
    expect(() =>
      parseCreateRequest({
        modelId: 'video-model',
        operation: 'video',
        input: { prompt: 'hello' },
      })
    ).toThrow(/B2/);
  });
});

