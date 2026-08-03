import { describe, expect, it } from 'vitest';
import { LS_KEYS } from '../../constants/storage-keys';
import {
  BOUND_TARGET_DISMISS_HINT_LIMIT,
  buildBoundTargetGenerationParams,
  readBoundTargetDismissHintCount,
  recordBoundTargetDismiss,
  resolveBoundTargetSuppression,
} from './target-bound-taskbar-state';

function createStorage(initialValue?: string) {
  const values = new Map<string, string>();
  if (initialValue !== undefined) {
    values.set(LS_KEYS.AI_BOUND_TARGET_DISMISS_HINT_COUNT, initialValue);
  }
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe('target-bound-taskbar-state', () => {
  it('累计五次关闭后固定隐藏提示计数', () => {
    const storage = createStorage();
    let currentCount = 0;

    for (let count = 1; count <= BOUND_TARGET_DISMISS_HINT_LIMIT; count += 1) {
      currentCount = recordBoundTargetDismiss(currentCount, storage);
      expect(currentCount).toBe(count);
    }

    expect(recordBoundTargetDismiss(currentCount, storage)).toBe(
      BOUND_TARGET_DISMISS_HINT_LIMIT
    );
    expect(readBoundTargetDismissHintCount(storage)).toBe(
      BOUND_TARGET_DISMISS_HINT_LIMIT
    );
  });

  it('忽略损坏计数且在存储不可用时不中断关闭操作', () => {
    expect(readBoundTargetDismissHintCount(createStorage('invalid'))).toBe(0);
    expect(recordBoundTargetDismiss(3, null)).toBe(4);
  });

  it('仅在同一目标仍选中时抑制重绑', () => {
    expect(resolveBoundTargetSuppression('image-a', 'image-a')).toEqual({
      suppressTarget: true,
      nextSuppressedElementId: 'image-a',
    });
    expect(resolveBoundTargetSuppression('image-b', 'image-a')).toEqual({
      suppressTarget: false,
      nextSuppressedElementId: null,
    });
    expect(resolveBoundTargetSuppression(null, 'image-a')).toEqual({
      suppressTarget: false,
      nextSuppressedElementId: null,
    });
  });

  it('关闭后不再生成目标替换参数，未关闭时保持原参数', () => {
    expect(buildBoundTargetGenerationParams(null)).toBeNull();
    expect(
      buildBoundTargetGenerationParams({
        elementId: 'image-a',
        prompt: '更新提示词',
        generationAnchorId: 'anchor-a',
        generationTaskId: 'task-a',
      })
    ).toEqual({
      generationMode: 'image_to_image',
      replaceElementId: 'image-a',
      targetElementId: 'image-a',
      anchorId: 'anchor-a',
      sourceTaskId: 'task-a',
      sourcePrompt: '更新提示词',
    });
  });
});
