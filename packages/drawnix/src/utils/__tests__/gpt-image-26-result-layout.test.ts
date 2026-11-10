import { describe, expect, it } from 'vitest';
import { GPT_IMAGE_26_MODEL_IDS } from '../../constants/model-config';
import {
  usesGPTImage26ResultColumns,
  getGPTImage26ResultColumnOrder,
  reservesGPTImage26ResultColumns,
} from '../gpt-image-26-result-layout';
import { precalculateTaskColumnLayout } from '../canvas-insertion-layout';

describe('GPT Image 2.6 task columns', () => {
  const result = {
    url: 'sheet.png',
    urls: ['sheet.png', 'animation.gif'],
    format: 'png',
    size: 1,
  };
  it.each(GPT_IMAGE_26_MODEL_IDS)(
    'keeps all outputs for %s while ranking GIF above the source sheet',
    (model) => {
      const task = { params: { model, prompt: 'animate' }, result };
      expect(usesGPTImage26ResultColumns(task)).toBe(true);
      expect(
        getGPTImage26ResultColumnOrder(task, 'animation.gif?token=1')
      ).toBe(0);
      expect(
        getGPTImage26ResultColumnOrder(task, 'data:image/gif;base64,R0lG')
      ).toBe(0);
      expect(getGPTImage26ResultColumnOrder(task, 'sheet.png')).toBe(1);
      expect(task.result.urls).toEqual(['sheet.png', 'animation.gif']);
      expect(reservesGPTImage26ResultColumns(model)).toBe(true);
      expect(reservesGPTImage26ResultColumns(model, 'svg')).toBe(false);
    }
  );

  it('keeps one-result and other models on their existing layout', () => {
    expect(
      usesGPTImage26ResultColumns({
        params: { model: 'gpt-image-2.6', prompt: '' },
        result: { ...result, urls: ['animation.gif'] },
      })
    ).toBe(false);
    expect(
      usesGPTImage26ResultColumns({
        params: { model: 'gpt-image-2.5', prompt: '' },
        result,
      })
    ).toBe(false);
    expect(reservesGPTImage26ResultColumns('gpt-image-2.5')).toBe(false);
    expect(
      usesGPTImage26ResultColumns({
        params: {
          model: 'other',
          modelRef: { profileId: 'tuzi', modelId: 'gpt-image-2.6' },
          prompt: '',
        },
        result,
      })
    ).toBe(true);
  });

  it('places GIFs above their own sheets without changing array order or wrapping narrow viewports', () => {
    const items = [
      { groupId: 'a', columnOrder: 1 },
      { groupId: 'a', columnOrder: 0 },
      { groupId: 'b', columnOrder: 0 },
      { groupId: 'b', columnOrder: 1 },
    ];
    const sizes = [
      { width: 400, height: 500 },
      { width: 300, height: 200 },
      { width: 200, height: 400 },
      { width: 400, height: 300 },
    ];
    const layout = precalculateTaskColumnLayout([100, 200], items, sizes, {
      horizontalGap: 40,
      verticalGap: 50,
    });
    expect(layout.positions).toEqual([
      [100, 450],
      [100, 200],
      [540, 200],
      [540, 650],
    ]);
    expect(layout.bounds).toEqual({ x: 100, y: 200, width: 840, height: 750 });
  });

  it('handles empty layouts and stable ordering for unknown output formats', () => {
    expect(precalculateTaskColumnLayout([10, 20], [], []).positions).toEqual(
      []
    );
    expect(
      precalculateTaskColumnLayout(
        [0, 0],
        [{ groupId: 'a' }, { groupId: 'a' }],
        [
          { width: 100, height: 50 },
          { width: 80, height: 70 },
        ]
      ).positions
    ).toEqual([
      [0, 0],
      [0, 100],
    ]);
  });
});
