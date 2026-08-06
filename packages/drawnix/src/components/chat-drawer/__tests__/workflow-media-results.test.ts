import { describe, expect, it } from 'vitest';
import type { WorkflowMessageData } from '../../../types/chat.types';
import {
  collectWorkflowMediaResults,
  getLatestWorkflowImageReferences,
  shouldUseImplicitWorkflowReferences,
} from '../workflow-media-results';

function createWorkflow(
  id: string,
  urls: string[],
  status: WorkflowMessageData['status'] = 'completed'
): WorkflowMessageData {
  return {
    id,
    name: '图片生成',
    generationType: 'image',
    prompt: '生成图片',
    count: urls.length,
    status,
    steps: [
      {
        id: `${id}-step`,
        description: '生成图片',
        status: 'completed',
        mcp: 'generate_image',
        args: {},
        result: {
          data: {
            urls,
          },
        },
      },
    ],
  };
}

describe('workflow media result helpers', () => {
  it('collects media urls from nested workflow results', () => {
    const workflow = createWorkflow('wf-1', [
      '/images/one.png',
      '/images/two.png',
    ]);

    expect(collectWorkflowMediaResults(workflow)).toEqual([
      {
        type: 'image',
        url: '/images/one.png',
        thumbnailUrl: undefined,
        title: undefined,
      },
      {
        type: 'image',
        url: '/images/two.png',
        thumbnailUrl: undefined,
        title: undefined,
      },
    ]);
  });

  it('returns the latest workflow images as reference content', () => {
    const first = createWorkflow('wf-1', ['/images/old.png']);
    const latest = createWorkflow('wf-2', ['/images/latest-1.png']);

    expect(getLatestWorkflowImageReferences([first, latest])).toEqual([
      {
        type: 'image',
        url: '/images/latest-1.png',
        name: '上一次生成结果 1',
      },
    ]);
  });

  it('recognizes continuation prompts without matching unrelated prompts', () => {
    expect(shouldUseImplicitWorkflowReferences('把上面的人改成小李子')).toBe(
      true
    );
    expect(shouldUseImplicitWorkflowReferences('生成一只猫')).toBe(false);
  });
});
