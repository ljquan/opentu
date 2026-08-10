import { describe, expect, it } from 'vitest';
import { LS_KEYS } from '../../constants/storage-keys';
import {
  CANVAS_ASSOCIATION_LABEL_LIMIT,
  CANVAS_ASSOCIATION_REFERENCE_LIMIT,
  appendCanvasAssociationRef,
  areCanvasAssociationRefsEqual,
  buildCanvasAssociationHighlightSegments,
  findCanvasAssociationTrigger,
  getCanvasAssociationMentionText,
  hasCanvasAssociationOverwriteContent,
  isCanvasAssociationTriggerActive,
  normalizeCanvasAssociationLabel,
  persistCanvasAssociationEnabled,
  readCanvasAssociationEnabled,
  reconcileCanvasAssociationRefsForPromptEdit,
  removeCanvasAssociationRef,
  removeCanvasAssociationMentionAtBoundary,
  removeCanvasAssociationTrigger,
  replaceCanvasAssociationTriggerWithMention,
  resolveCanvasAssociationPromptEdit,
  resolveCanvasAssociationPromptEditFromInputEvent,
  resolveCanvasAssociationTaskLinkTiming,
  snapshotCanvasAssociationRefs,
  shouldClearSubmittedCanvasAssociations,
  shouldStartCanvasAssociationPicking,
  type CanvasAssociationRef,
} from './canvas-association-state';

function createStorage(initialValue?: string) {
  const values = new Map<string, string>();
  if (initialValue !== undefined) {
    values.set(LS_KEYS.AI_CANVAS_ASSOCIATION_ENABLED, initialValue);
  }
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

function createReference(
  elementId: string,
  overrides: Partial<CanvasAssociationRef> = {}
): CanvasAssociationRef {
  return {
    referenceId: `ref-${elementId}`,
    boardId: 'board-a',
    elementId,
    kind: 'image',
    label: `图片 ${elementId}`,
    ...overrides,
  };
}

describe('canvas-association-state', () => {
  it('联想默认关闭，仅显式 true 时开启', () => {
    expect(readCanvasAssociationEnabled(createStorage())).toBe(false);
    expect(readCanvasAssociationEnabled(createStorage('false'))).toBe(false);
    expect(readCanvasAssociationEnabled(createStorage('invalid'))).toBe(false);
    expect(readCanvasAssociationEnabled(createStorage('true'))).toBe(true);
  });

  it('持久化最后选择，存储失败时仍保留页面内返回值', () => {
    const storage = createStorage();
    const blockedStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };

    expect(persistCanvasAssociationEnabled(true, storage)).toBe(true);
    expect(readCanvasAssociationEnabled(storage)).toBe(true);
    expect(persistCanvasAssociationEnabled(false, storage)).toBe(false);
    expect(readCanvasAssociationEnabled(storage)).toBe(false);
    expect(readCanvasAssociationEnabled(blockedStorage)).toBe(false);
    expect(persistCanvasAssociationEnabled(true, blockedStorage)).toBe(true);
    expect(persistCanvasAssociationEnabled(true, null)).toBe(true);
  });

  it('识别任意位置刚输入的 @，并忽略输入法组合', () => {
    expect(findCanvasAssociationTrigger('@', 1)).toEqual({ start: 0, end: 1 });
    expect(findCanvasAssociationTrigger('画面 @', 4)).toEqual({
      start: 3,
      end: 4,
    });
    expect(findCanvasAssociationTrigger('画面\n@', 4)).toEqual({
      start: 3,
      end: 4,
    });
    expect(findCanvasAssociationTrigger('a@', 2)).toBeNull();
    expect(findCanvasAssociationTrigger('@foo', 1)).toBeNull();
    expect(findCanvasAssociationTrigger('@ foo', 1)).toEqual({
      start: 0,
      end: 1,
    });
    expect(findCanvasAssociationTrigger('@a', 2)).toBeNull();
    expect(findCanvasAssociationTrigger('@', 1, true)).toBeNull();
    expect(findCanvasAssociationTrigger('@', 2)).toBeNull();
  });

  it.each([
    ['beforeinput 文本输入', 'insertText', 'insertFromPaste', true],
    ['beforeinput 组合输入', 'insertCompositionText', 'insertFromPaste', true],
    ['onChange 文本输入回退', '', 'insertText', true],
    ['onChange 组合输入回退', undefined, 'insertCompositionText', true],
    ['beforeinput 粘贴优先', 'insertFromPaste', 'insertText', false],
    ['onChange 粘贴回退', '', 'insertFromPaste', false],
    ['程序化回填', undefined, undefined, false],
    ['删除操作', 'deleteContentBackward', 'insertText', false],
  ] as const)(
    '%s 时联想拾取判定为 %s',
    (_label, beforeInputType, changeInputType, expected) => {
      expect(
        shouldStartCanvasAssociationPicking(beforeInputType, changeInputType)
      ).toBe(expected);
    }
  );

  it('输入或选区变化后仅保留光标紧邻的最新 @ 触发', () => {
    const trigger = { start: 0, end: 1 };

    expect(isCanvasAssociationTriggerActive('@', 1, 1, trigger)).toBe(true);
    expect(isCanvasAssociationTriggerActive('@a', 2, 2, trigger)).toBe(false);
    expect(isCanvasAssociationTriggerActive('@', 0, 0, trigger)).toBe(false);
    expect(isCanvasAssociationTriggerActive('@', 0, 1, trigger)).toBe(false);
    expect(isCanvasAssociationTriggerActive('@', 0, 0, trigger, true)).toBe(
      true
    );
  });

  it('外部 prefill 仅有单个联想引用时也要求覆盖确认', () => {
    expect(
      hasCanvasAssociationOverwriteContent([createReference('image-a')], null)
    ).toBe(true);
    expect(hasCanvasAssociationOverwriteContent([], null)).toBe(false);
  });

  it('待处理 @ 属于覆盖前需确认的内容', () => {
    expect(hasCanvasAssociationOverwriteContent([], { start: 0, end: 1 })).toBe(
      true
    );
  });

  it('仅在原触发字符仍存在时删除 @ 并恢复光标', () => {
    expect(
      removeCanvasAssociationTrigger('前 @ 后', { start: 2, end: 3 })
    ).toEqual({
      prompt: '前  后',
      cursorPosition: 2,
      removed: true,
    });
    expect(
      removeCanvasAssociationTrigger('前 X 后', { start: 2, end: 3 })
    ).toEqual({
      prompt: '前 X 后',
      cursorPosition: 3,
      removed: false,
    });
  });

  it('把触发符替换成可读正文 mention 并记录可信范围', () => {
    const reference = createReference('image-a', { label: '  图片一  ' });
    const result = replaceCanvasAssociationTriggerWithMention(
      '人物是@，声音自然',
      { start: 3, end: 4 },
      reference
    );

    expect(result).toEqual({
      prompt: '人物是@图片一，声音自然',
      cursorPosition: 7,
      reference: {
        ...reference,
        label: '图片一',
        mentionStart: 3,
        mentionEnd: 7,
      },
      inserted: true,
    });
    expect(getCanvasAssociationMentionText(result.reference)).toBe('@图片一');
  });

  it('文本编辑会平移完整 mention，跨 mention 编辑会移除对象身份', () => {
    const prompt = '人物是@图片一，声音是@音频一';
    const image = createReference('image-a', {
      label: '图片一',
      mentionStart: 3,
      mentionEnd: 7,
    });
    const audio = createReference('audio-a', {
      kind: 'audio',
      label: '音频一',
      mentionStart: 11,
      mentionEnd: 15,
    });

    expect(
      reconcileCanvasAssociationRefsForPromptEdit(
        prompt,
        `请让${prompt}`,
        [image, audio],
        { start: 0, end: 0 }
      )
    ).toEqual([
      { ...image, mentionStart: 5, mentionEnd: 9 },
      { ...audio, mentionStart: 13, mentionEnd: 17 },
    ]);

    expect(
      reconcileCanvasAssociationRefsForPromptEdit(
        prompt,
        '人物是@图一，声音是@音频一',
        [image, audio],
        { start: 5, end: 6 }
      )
    ).toEqual([{ ...audio, mentionStart: 10, mentionEnd: 14 }]);
  });

  it('纯文本不能伪造引用，高亮只接受与可信范围完全匹配的 token', () => {
    const prompt = '使用@图片一和@图片二';
    const trusted = createReference('image-a', {
      label: '图片一',
      mentionStart: 2,
      mentionEnd: 6,
    });
    const forged = createReference('image-b', { label: '图片二' });

    expect(
      reconcileCanvasAssociationRefsForPromptEdit(
        '使用@图片一',
        prompt,
        [trusted],
        { start: 6, end: 6 }
      )
    ).toEqual([trusted]);
    expect(
      buildCanvasAssociationHighlightSegments(prompt, [trusted, forged])
    ).toEqual([
      { text: '使用' },
      { text: '@图片一', referenceId: trusted.referenceId },
      { text: '和@图片二' },
    ]);
    expect(
      buildCanvasAssociationHighlightSegments('@图片二', [forged])
    ).toEqual([{ text: '@图片二' }]);
  });

  it('使用显式编辑范围区分重复同名 mention，不交换对象身份', () => {
    const first = createReference('image-a', {
      label: '图片',
      mentionStart: 0,
      mentionEnd: 3,
    });
    const second = createReference('image-b', {
      label: '图片',
      mentionStart: 4,
      mentionEnd: 7,
    });

    expect(
      reconcileCanvasAssociationRefsForPromptEdit(
        '@图片 @图片',
        '@图片',
        [first, second],
        { start: 0, end: 4 }
      )
    ).toEqual([{ ...second, mentionStart: 0, mentionEnd: 3 }]);
    expect(
      reconcileCanvasAssociationRefsForPromptEdit('@图片 @图片', '@图片', [
        first,
        second,
      ])
    ).toEqual([]);
  });

  it('根据 beforeinput 选区解析插入、前删与后删的旧值范围', () => {
    expect(
      resolveCanvasAssociationPromptEdit('A@图片', 'AB@图片', {
        selectionStart: 1,
        selectionEnd: 1,
        inputType: 'insertText',
      })
    ).toEqual({ start: 1, end: 1 });
    expect(
      resolveCanvasAssociationPromptEdit('AB@图片', 'A@图片', {
        selectionStart: 2,
        selectionEnd: 2,
        inputType: 'deleteContentBackward',
      })
    ).toEqual({ start: 1, end: 2 });
    expect(
      resolveCanvasAssociationPromptEdit('@图片AB', '@图片A', {
        selectionStart: 4,
        selectionEnd: 4,
        inputType: 'deleteContentForward',
      })
    ).toEqual({ start: 4, end: 5 });
    expect(
      resolveCanvasAssociationPromptEdit('@图片', '历史值', {
        selectionStart: 0,
        selectionEnd: 0,
        inputType: 'historyUndo',
      })
    ).toBeNull();
  });

  it('beforeinput 缺失时根据 InputEvent 和编辑后光标保留 mention 身份', () => {
    const reference = createReference('image-a', {
      label: '图片',
      mentionStart: 0,
      mentionEnd: 3,
    });
    let previousPrompt = '@图片';
    let nextPrompt = '@图片 ';
    let edit = resolveCanvasAssociationPromptEditFromInputEvent(
      previousPrompt,
      nextPrompt,
      {
        selectionStart: 4,
        selectionEnd: 4,
        inputType: 'insertText',
        data: ' ',
      }
    );
    let references = reconcileCanvasAssociationRefsForPromptEdit(
      previousPrompt,
      nextPrompt,
      [reference],
      edit
    );
    expect(edit).toEqual({ start: 3, end: 3 });
    expect(references).toEqual([reference]);

    previousPrompt = nextPrompt;
    nextPrompt = '@图片 @';
    edit = resolveCanvasAssociationPromptEditFromInputEvent(
      previousPrompt,
      nextPrompt,
      {
        selectionStart: 5,
        selectionEnd: 5,
        inputType: 'insertText',
        data: '@',
      }
    );
    references = reconcileCanvasAssociationRefsForPromptEdit(
      previousPrompt,
      nextPrompt,
      references,
      edit
    );
    expect(edit).toEqual({ start: 4, end: 4 });
    expect(references).toEqual([reference]);
  });

  it('InputEvent 回退能区分重复同名 mention 的对象身份', () => {
    const first = createReference('image-a', {
      label: '图片',
      mentionStart: 0,
      mentionEnd: 3,
    });
    const second = createReference('image-b', {
      label: '图片',
      mentionStart: 4,
      mentionEnd: 7,
    });
    const edit = resolveCanvasAssociationPromptEditFromInputEvent(
      '@图片 @图片',
      '@图片 x@图片',
      {
        selectionStart: 5,
        selectionEnd: 5,
        inputType: 'insertCompositionText',
        data: 'x',
      }
    );

    expect(edit).toEqual({ start: 4, end: 4 });
    expect(
      reconcileCanvasAssociationRefsForPromptEdit(
        '@图片 @图片',
        '@图片 x@图片',
        [first, second],
        edit
      )
    ).toEqual([first, { ...second, mentionStart: 5, mentionEnd: 8 }]);
  });

  it.each([
    ['粘贴', 'insertFromPaste', 'x', 1, 1],
    ['程序化回填', undefined, 'x', 1, 1],
    ['缺少 data', 'insertText', null, 1, 1],
    ['data 与正文不符', 'insertText', 'y', 1, 1],
    ['非折叠光标', 'insertText', 'x', 0, 1],
  ] as const)(
    '%s 不能伪造 InputEvent 编辑范围',
    (_label, inputType, data, selectionStart, selectionEnd) => {
      expect(
        resolveCanvasAssociationPromptEditFromInputEvent('@图片', 'x@图片', {
          selectionStart,
          selectionEnd,
          inputType,
          data,
        })
      ).toBeNull();
    }
  );

  it.each([
    ['backward' as const, 3],
    ['forward' as const, 0],
  ])('%s 在 mention 边界整项删除并平移后续范围', (direction, caret) => {
    const first = createReference('image-a', {
      label: '图片',
      mentionStart: 0,
      mentionEnd: 3,
    });
    const second = createReference('image-b', {
      label: '声音',
      mentionStart: 4,
      mentionEnd: 7,
    });

    expect(
      removeCanvasAssociationMentionAtBoundary(
        '@图片 @声音',
        [first, second],
        caret,
        caret,
        direction
      )
    ).toEqual({
      prompt: ' @声音',
      cursorPosition: 0,
      references: [{ ...second, mentionStart: 1, mentionEnd: 4 }],
      removedReferenceId: first.referenceId,
    });
  });

  it('规范化标签并限制长度，不保留换行和无界文本', () => {
    expect(normalizeCanvasAssociationLabel('  图片\n  一  ')).toBe('图片 一');
    expect(normalizeCanvasAssociationLabel('   ', '元素')).toBe('元素');
    expect(normalizeCanvasAssociationLabel('x'.repeat(100))).toHaveLength(
      CANVAS_ASSOCIATION_LABEL_LIMIT
    );
  });

  it('按画板和元素去重，不修改调用方数组', () => {
    const original = [createReference('image-a')];
    const duplicate = appendCanvasAssociationRef(
      original,
      createReference('image-a', { referenceId: 'another-ref' })
    );
    const added = appendCanvasAssociationRef(
      original,
      createReference('image-b', { label: '  新图  ' })
    );

    expect(duplicate).toMatchObject({
      added: false,
      duplicate: true,
      limitReached: false,
    });
    expect(duplicate.references).not.toBe(original);
    expect(added).toMatchObject({
      added: true,
      duplicate: false,
      limitReached: false,
    });
    expect(added.references).toHaveLength(2);
    expect(added.references[1].label).toBe('新图');
    expect(original).toHaveLength(1);
  });

  it('相同元素在不同画板可独立引用', () => {
    const original = [createReference('image-a')];
    const result = appendCanvasAssociationRef(
      original,
      createReference('image-a', {
        referenceId: 'ref-board-b',
        boardId: 'board-b',
      })
    );

    expect(result.added).toBe(true);
    expect(result.references).toHaveLength(2);
  });

  it('达到引用上限后拒绝新增并保留已有引用', () => {
    const references = Array.from(
      { length: CANVAS_ASSOCIATION_REFERENCE_LIMIT },
      (_, index) => createReference(`image-${index}`)
    );
    const result = appendCanvasAssociationRef(
      references,
      createReference('overflow')
    );

    expect(result).toMatchObject({
      added: false,
      duplicate: false,
      limitReached: true,
    });
    expect(result.references).toEqual(references);
    expect(result.references).not.toBe(references);
  });

  it('支持按引用 ID 删除且不修改调用方数组', () => {
    const references = [createReference('image-a'), createReference('image-b')];
    const next = removeCanvasAssociationRef(references, 'ref-image-a');

    expect(next).toEqual([references[1]]);
    expect(references).toHaveLength(2);
  });

  it('提交快照去重、过滤失效 ID、限制数量并复制对象', () => {
    const first = createReference('image-a');
    const references = [
      first,
      createReference('image-a', { referenceId: 'duplicate' }),
      createReference('invalid', { boardId: ' ', elementId: ' ' }),
      createReference('image-b'),
    ];
    const snapshot = snapshotCanvasAssociationRefs(references, 2);

    expect(snapshot.map((item) => item.elementId)).toEqual([
      'image-a',
      'image-b',
    ]);
    expect(snapshot[0]).not.toBe(first);
    expect(snapshotCanvasAssociationRefs(references, 0)).toEqual([]);
  });

  it('提交并发比较覆盖引用的全部持久字段', () => {
    const original = createReference('image-a');
    expect(areCanvasAssociationRefsEqual([original], [{ ...original }])).toBe(
      true
    );

    for (const changed of [
      { referenceId: 'new-ref' },
      { boardId: 'board-b' },
      { elementId: 'image-b' },
      { kind: 'video' as const },
      { label: '新标签' },
      { mentionStart: 1 },
      { mentionEnd: 4 },
    ]) {
      expect(
        areCanvasAssociationRefsEqual([original], [{ ...original, ...changed }])
      ).toBe(false);
    }
  });

  it('仅在主线程成功或队列已接收任务时清理提交引用', () => {
    expect(shouldClearSubmittedCanvasAssociations(false, 0)).toBe(true);
    expect(shouldClearSubmittedCanvasAssociations(true, 1)).toBe(true);
    expect(shouldClearSubmittedCanvasAssociations(true, 0)).toBe(false);
  });

  it('仅在提交接受后连线，切板时延迟到原板恢复', () => {
    expect(
      resolveCanvasAssociationTaskLinkTiming({
        submissionAccepted: false,
        associationCount: 1,
        hasTaskTarget: true,
        submittedBoardIsCurrent: true,
      })
    ).toBe('none');
    expect(
      resolveCanvasAssociationTaskLinkTiming({
        submissionAccepted: true,
        associationCount: 1,
        hasTaskTarget: true,
        submittedBoardIsCurrent: true,
      })
    ).toBe('immediate');
    expect(
      resolveCanvasAssociationTaskLinkTiming({
        submissionAccepted: true,
        associationCount: 1,
        hasTaskTarget: true,
        submittedBoardIsCurrent: false,
      })
    ).toBe('deferred');
    expect(
      resolveCanvasAssociationTaskLinkTiming({
        submissionAccepted: true,
        associationCount: 0,
        hasTaskTarget: true,
        submittedBoardIsCurrent: true,
      })
    ).toBe('none');
  });
});
