import { describe, expect, it } from 'vitest';
import { LS_KEYS } from '../../constants/storage-keys';
import {
  BOUND_TARGET_DISMISS_HINT_LIMIT,
  areBoundTargetTaskbarDraftsEqual,
  buildBoundTargetGenerationParams,
  collectBoundTargetElementIds,
  createBoundImageTargetStateKey,
  findBoundTargetElement,
  isBoundTargetReferenceOnly,
  pinBoundTargetReferenceContent,
  pruneStaleBoundTargetTaskbarDrafts,
  readBoundTargetDismissHintCount,
  recordBoundTargetDismiss,
  resolveBoundTargetTaskbarDraft,
  resolveBoundTargetSuppression,
  resolveTaskbarDraftAfterSubmission,
  shouldUseBoundTargetForSubmission,
  storeBoundTargetTaskbarDraft,
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
  it('仅把显式标记的图片视为永久参考图模式', () => {
    expect(isBoundTargetReferenceOnly({ aiTaskbarReferenceOnly: true })).toBe(
      true
    );
    expect(isBoundTargetReferenceOnly({ aiTaskbarReferenceOnly: false })).toBe(
      false
    );
    expect(isBoundTargetReferenceOnly({})).toBe(false);
    expect(isBoundTargetReferenceOnly(null)).toBe(false);
  });

  it('可从嵌套画板结构中找到永久设置的目标图片', () => {
    const image = { id: 'image-nested', type: 'image' };
    const elements = [
      {
        id: 'frame-a',
        children: [{ id: 'group-a', children: [image] }],
      },
    ];

    expect(findBoundTargetElement(elements, 'image-nested')).toBe(image);
    expect(findBoundTargetElement(elements, 'image-missing')).toBeNull();
  });

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

  it('目标状态键区分跟随、临时参考和永久参考', () => {
    const target = {
      elementId: 'image-a',
      url: 'https://example.com/image-a.png',
      prompt: '海边',
      generationTaskId: 'task-a',
      generationAnchorId: 'anchor-a',
      referenceOnly: false,
    };

    expect(createBoundImageTargetStateKey(target, 'follow')).not.toBe(
      createBoundImageTargetStateKey(target, 'reference')
    );
    expect(createBoundImageTargetStateKey(target, 'reference')).not.toBe(
      createBoundImageTargetStateKey(
        { ...target, referenceOnly: true },
        'reference'
      )
    );
    expect(createBoundImageTargetStateKey(target, 'reference')).toBe(
      createBoundImageTargetStateKey({ ...target }, 'reference')
    );
  });

  it('从对话抽屉提交时仍将当前图片置于参考图首位', () => {
    const target = { url: 'target.png', name: '当前图片' };
    const uploaded = { url: 'uploaded.png', name: '抽屉上传' };

    expect(
      pinBoundTargetReferenceContent(
        [uploaded, { ...target }],
        target,
        'reference'
      )
    ).toEqual([target, uploaded]);
    expect(
      pinBoundTargetReferenceContent([uploaded, target], target, 'follow')
    ).toEqual([uploaded, target]);
  });

  it('按图片保存并恢复独立草稿，不把 A 的内容带到 B', () => {
    const uploadA = { id: 'upload-a' };
    const knowledgeA = { id: 'knowledge-a' };
    const baselineA = {
      prompt: '兔子',
      uploadedContent: [],
      knowledgeContextRefs: [],
    };
    const draftA = {
      prompt: '兔子，12',
      uploadedContent: [uploadA],
      knowledgeContextRefs: [knowledgeA],
    };
    const drafts = new Map();

    storeBoundTargetTaskbarDraft(drafts, 'image-a', draftA, baselineA);

    expect(
      resolveBoundTargetTaskbarDraft(drafts, 'image-b', {
        prompt: '海边',
        uploadedContent: [],
        knowledgeContextRefs: [],
      }).draft
    ).toEqual({
      prompt: '海边',
      uploadedContent: [],
      knowledgeContextRefs: [],
    });
    expect(
      resolveBoundTargetTaskbarDraft(drafts, 'image-a', baselineA)
    ).toEqual({
      draft: draftA,
      baseline: baselineA,
    });
  });

  it('内容恢复到图片默认值后移除冗余草稿', () => {
    const drafts = new Map();
    const baseline = {
      prompt: '兔子',
      uploadedContent: [],
      knowledgeContextRefs: [],
    };
    storeBoundTargetTaskbarDraft(
      drafts,
      'image-a',
      { ...baseline, prompt: '兔子，12' },
      baseline
    );
    expect(drafts.has('image-a')).toBe(true);

    storeBoundTargetTaskbarDraft(drafts, 'image-a', baseline, baseline);
    expect(drafts.has('image-a')).toBe(false);
    expect(areBoundTargetTaskbarDraftsEqual(baseline, baseline)).toBe(true);
  });

  it('目标默认提示词更新时只重置未编辑的提示词', () => {
    const drafts = new Map();
    const upload = { id: 'upload-a' };
    const baseline = {
      prompt: '旧提示词',
      uploadedContent: [],
      knowledgeContextRefs: [],
    };
    storeBoundTargetTaskbarDraft(
      drafts,
      'image-a',
      { ...baseline, uploadedContent: [upload] },
      baseline
    );
    expect(
      resolveBoundTargetTaskbarDraft(drafts, 'image-a', {
        ...baseline,
        prompt: '新提示词',
      }).draft.prompt
    ).toBe('新提示词');

    storeBoundTargetTaskbarDraft(
      drafts,
      'image-a',
      { ...baseline, prompt: '手动提示词' },
      baseline
    );
    expect(
      resolveBoundTargetTaskbarDraft(drafts, 'image-a', {
        ...baseline,
        prompt: '新提示词',
      }).draft.prompt
    ).toBe('手动提示词');
  });

  it('提交后只清理已发送内容，保留提交期间的新编辑', () => {
    const submitted = {
      prompt: '已发送提示词',
      uploadedContent: [{ id: 'upload-a' }],
      knowledgeContextRefs: [],
    };
    const empty = {
      prompt: '',
      uploadedContent: [],
      knowledgeContextRefs: [],
    };

    expect(
      resolveTaskbarDraftAfterSubmission(submitted, submitted, empty, true)
    ).toEqual({
      draft: empty,
      baseline: empty,
      hasNewerInput: false,
    });

    const newer = { ...submitted, prompt: '提交后新增内容' };
    expect(
      resolveTaskbarDraftAfterSubmission(newer, submitted, empty, true)
    ).toEqual({
      draft: newer,
      baseline: submitted,
      hasNewerInput: true,
    });
  });

  it('图片删除后回收其草稿引用', () => {
    const drafts = new Map([
      ['image-a', { prompt: 'A' }],
      ['image-b', { prompt: 'B' }],
    ]);

    pruneStaleBoundTargetTaskbarDrafts(drafts, new Set(['image-b']));

    expect([...drafts.keys()]).toEqual(['image-b']);
  });

  it('嵌套图片仍存在时不会被当作已删除元素', () => {
    const existingElementIds = collectBoundTargetElementIds([
      {
        id: 'frame-a',
        children: [{ id: 'image-nested' }],
      },
      { id: 'image-top-level' },
    ]);
    const drafts = new Map([
      ['image-nested', { prompt: '嵌套图片草稿' }],
      ['image-deleted', { prompt: '已删除图片草稿' }],
    ]);

    pruneStaleBoundTargetTaskbarDrafts(drafts, existingElementIds);

    expect(existingElementIds).toEqual(
      new Set(['frame-a', 'image-nested', 'image-top-level'])
    );
    expect([...drafts.keys()]).toEqual(['image-nested']);
  });

  it('仅图片模式执行绑定目标原位替换', () => {
    expect(shouldUseBoundTargetForSubmission('image', 'follow')).toBe(true);
    expect(shouldUseBoundTargetForSubmission('image', 'reference')).toBe(false);
    expect(shouldUseBoundTargetForSubmission('video', 'follow')).toBe(false);
    expect(shouldUseBoundTargetForSubmission('agent', 'follow')).toBe(false);
    expect(shouldUseBoundTargetForSubmission('text', 'follow')).toBe(false);
  });

  it('仅作参考时不生成覆盖参数，跟随时保持原参数', () => {
    const target = {
      elementId: 'image-a',
      prompt: '更新提示词',
      generationAnchorId: 'anchor-a',
      generationTaskId: 'task-a',
    };
    const referenceTarget = shouldUseBoundTargetForSubmission(
      'image',
      'reference'
    )
      ? target
      : null;

    expect(buildBoundTargetGenerationParams(referenceTarget)).toBeNull();
    expect(buildBoundTargetGenerationParams(target)).toEqual({
      generationMode: 'image_to_image',
      replaceElementId: 'image-a',
      targetElementId: 'image-a',
      anchorId: 'anchor-a',
      sourceTaskId: 'task-a',
      sourcePrompt: '更新提示词',
    });
  });

  it('选择多张时不生成目标替换参数', () => {
    expect(
      buildBoundTargetGenerationParams(
        {
          elementId: 'image-a',
          prompt: '生成多个候选图',
          generationAnchorId: 'anchor-a',
          generationTaskId: 'task-a',
        },
        5
      )
    ).toBeNull();
  });
});
