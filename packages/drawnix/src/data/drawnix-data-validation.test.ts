import { describe, expect, it } from 'vitest';
import { isValidDrawnixData } from './drawnix-data-validation';

const documentWith = (elements: unknown[]) => ({ type: 'drawnix', viewport: { zoom: 1 }, elements });

describe('untrusted drawing imports', () => {
  it('preserves text leaves and registered-style component identifiers', () => {
    expect(isValidDrawnixData(documentWith([
      { type: 'text', children: [{ text: 'hello' }] },
      { type: 'tool', component: 'internal:music-player' },
    ]))).toBe(true);
  });

  it('rejects HTML component names, null records and excessive nesting', () => {
    expect(isValidDrawnixData(documentWith([{ type: 'tool', component: '<img src=x onerror=alert(1)>' }]))).toBe(false);
    expect(isValidDrawnixData(documentWith([null]))).toBe(false);
    expect(isValidDrawnixData(documentWith([{ type: 'tool', url: 'javascript:alert(1)' }]))).toBe(false);
    expect(isValidDrawnixData({ type: 'drawnix', viewport: null, elements: [] })).toBe(false);
    let element: unknown = { text: 'leaf' };
    for (let i = 0; i < 40; i++) element = { children: [element] };
    expect(isValidDrawnixData(documentWith([element]))).toBe(false);
  });
});
