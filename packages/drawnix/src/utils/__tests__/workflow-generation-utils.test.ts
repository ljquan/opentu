import { describe, expect, it } from 'vitest';
import type { VideoCharacter, VideoShot } from '../../services/video-analysis-service';
import {
  buildWorkflowDownloadScript,
  getWorkflowExportBaseName,
  getWorkflowExportIndexWidth,
  resetCharacterReferenceImages,
  resetGeneratedShots,
} from '../workflow-generation-utils';

describe('workflow-generation-utils', () => {
  it('resets generated shot assets without touching prompts', () => {
    const shots: VideoShot[] = [{
      id: 'shot_1',
      startTime: 0,
      endTime: 3,
      description: 'desc',
      type: 'opening',
      label: '开场',
      first_frame_prompt: 'first',
      last_frame_prompt: 'last',
      generated_first_frame_url: 'first-url',
      generated_last_frame_url: 'last-url',
      generated_video_url: 'video-url',
      suppressed_generated_urls: {
        first: 'a',
        last: 'b',
        video: 'c',
      },
    }];

    expect(resetGeneratedShots(shots)).toEqual([{
      ...shots[0],
      generated_first_frame_url: undefined,
      generated_last_frame_url: undefined,
      generated_video_url: undefined,
      suppressed_generated_urls: undefined,
    }]);
  });

  it('resets character reference images only', () => {
    const characters: VideoCharacter[] = [{
      id: 'char_1',
      name: '主角',
      description: 'young woman',
      referenceImageUrl: 'ref-url',
    }];

    expect(resetCharacterReferenceImages(characters)).toEqual([{
      ...characters[0],
      referenceImageUrl: undefined,
    }]);
  });

  it('builds stable export names and download script', () => {
    expect(getWorkflowExportIndexWidth(12)).toBe(2);
    expect(getWorkflowExportBaseName(0, 'first', 2)).toBe('01.首帧');
    expect(getWorkflowExportBaseName(9, 'video', 2)).toBe('10.视频');
    const script = buildWorkflowDownloadScript('00.manifest.json');
    expect(script).toContain('00.manifest.json');
    expect(script).toContain('download_if_missing');
  });
});
