// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlaitBoard } from '@plait/core';
import { prepareImageMaskSubmission } from './image-mask-submission';
import {
  resolveBoundTargetMode,
  pinBoundTargetReferenceContent,
  shouldUseBoundTargetForSubmission,
} from './target-bound-taskbar-state';
import {
  buildTuziGPTImageEditFormData,
  getTuziGPTImageRequestPath,
} from '../../services/model-adapters/tuzi-gpt-image-adapter';

const { readMask } = vi.hoisted(() => ({ readMask: vi.fn() }));
vi.mock('../../utils/selection-utils', () => ({ getImageMaskEditForAI: readMask }));

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const target = { type: 'image', elementId: 'left-cup', url: '/source.png' };
const content = [{ type: 'image', url: target.url, name: '参考图' }];
const board = { children: [] } as unknown as PlaitBoard;

beforeEach(() => {
  readMask.mockReset().mockResolvedValue({ url: png, maskImage: png, width: 1254, height: 1254 });
});

describe('prepareImageMaskSubmission', () => {
  it.each([false, true])('任务栏跟随开关为 %s 时均提交原图和独立蒙版', async (followEnabled) => {
    const mode = resolveBoundTargetMode('follow', followEnabled, 'image');
    const replacementTarget = shouldUseBoundTargetForSubmission('image', mode) ? target : null;
    const prepared = await prepareImageMaskSubmission(board, replacementTarget || target, 'image', content);
    const request = {
      model: 'gpt-image-2.5', prompt: '这个杯子换个颜色',
      referenceImages: prepared.content.map(item => item.url),
      maskImage: prepared.maskEdit?.maskImage,
    };
    expect(readMask).toHaveBeenCalledWith(board, 'left-cup');
    expect(getTuziGPTImageRequestPath(request)).toBe('/images/edits');
    const form = await buildTuziGPTImageEditFormData(request);
    expect(form.getAll('image[]')).toHaveLength(1);
    expect(form.get('mask')).toBeInstanceOf(Blob);
    expect(content[0].url).toBe('/source.png');
  });

  it('凭据流程恢复时保留提交前的蒙版快照', async () => {
    const snapshot = await prepareImageMaskSubmission(board, target, 'image', content);
    readMask.mockClear();
    const resumedContent = pinBoundTargetReferenceContent(
      snapshot.content, { type: 'image', url: png, name: '参考图' }, 'reference'
    );
    const resumed = await prepareImageMaskSubmission(board, { ...target, url: png }, 'image', resumedContent);
    expect(resumed.maskEdit).toEqual(snapshot.maskEdit);
    expect(readMask).not.toHaveBeenCalled();
  });

  it('其他图片的请求不会混入当前选区蒙版', async () => {
    const other = [{ type: 'image', url: '/another.png' }];
    const prepared = await prepareImageMaskSubmission(board, target, 'image', other);
    expect(prepared).toEqual({ content: other, maskEdit: null });
    expect(readMask).not.toHaveBeenCalled();
  });

  it.each(['video', 'agent'])('%s 生成保持已有引用逻辑', async (generationType) => {
    expect(await prepareImageMaskSubmission(board, target, generationType, content))
      .toEqual({ content, maskEdit: null });
    expect(readMask).not.toHaveBeenCalled();
  });

  it('语义分层替换保留其专用蒙版流程', async () => {
    await prepareImageMaskSubmission(board, { ...target, semanticReplacement: {} }, 'image', content);
    expect(readMask).not.toHaveBeenCalled();
  });

  it('无笔迹时继续普通生成', async () => {
    readMask.mockResolvedValueOnce(null);
    expect(await prepareImageMaskSubmission(board, target, 'image', content))
      .toEqual({ content, maskEdit: null });
  });

  it('蒙版失败时终止准备而不是降级为无蒙版请求', async () => {
    readMask.mockRejectedValueOnce(new Error('蒙版生成失败'));
    await expect(prepareImageMaskSubmission(board, target, 'image', content))
      .rejects.toThrow('蒙版生成失败');
  });
});
