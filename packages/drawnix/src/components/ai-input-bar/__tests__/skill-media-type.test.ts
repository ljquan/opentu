import { describe, expect, it } from 'vitest';
import {
  inferSkillMediaTypes,
  normalizeSkillOutputType,
} from '../skill-media-type';

describe('skill-media-type', () => {
  it('PPT 大纲 Skill 不触发媒体模型选择', () => {
    expect(normalizeSkillOutputType('ppt')).toBeUndefined();
    expect(inferSkillMediaTypes({ outputType: 'ppt' })).toEqual([]);
  });

  it('优先使用显式输出类型', () => {
    expect(
      inferSkillMediaTypes({
        outputType: 'video',
        content: '调用 generate_image',
      })
    ).toEqual(['video']);
  });

  it('从工具名和内容推断媒体类型', () => {
    expect(inferSkillMediaTypes({ mcpTool: 'generate_audio' })).toEqual([
      'audio',
    ]);
    expect(
      inferSkillMediaTypes({
        content: '先调用 generate_image，再调用 generate_video',
      })
    ).toEqual(['image', 'video']);
  });

  it('PPT 讲解视频 Skill 同时显示图片和成片模型选择', () => {
    expect(
      inferSkillMediaTypes({
        mcpTool: 'generate_ppt_explainer_video',
        outputType: 'video',
      })
    ).toEqual(['image', 'video']);
  });
});
