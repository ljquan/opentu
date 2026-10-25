import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VideoCharacter, VideoShot } from '../../services/video-analysis-service';
import {
  buildWorkflowDownloadScript,
  collectWorkflowExportAssets,
  exportWorkflowAssetsZip,
  getWorkflowExportBaseName,
  getWorkflowExportIndexWidth,
  resetCharacterReferenceImages,
  resetGeneratedShots,
  resetWorkflowGeneratedAssets,
} from '../workflow-generation-utils';

const { downloadFromBlobMock } = vi.hoisted(() => ({
  downloadFromBlobMock: vi.fn<(blob: Blob, filename: string) => void>(),
}));

vi.mock('@aitu/utils', async () => {
  const actual = await vi.importActual<typeof import('@aitu/utils')>('@aitu/utils');
  return {
    ...actual,
    downloadFromBlob: downloadFromBlobMock,
  };
});

afterEach(() => {
  downloadFromBlobMock.mockReset();
  vi.unstubAllGlobals();
});

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
      suppressed_generated_urls: {
        first: 'first-url',
        last: 'last-url',
        video: 'video-url',
      },
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

  it('resets workflow shots and character refs together', () => {
    const shots: VideoShot[] = [{
      id: 'shot_1',
      startTime: 0,
      endTime: 3,
      description: 'desc',
      type: 'opening',
      label: '开场',
      generated_video_url: 'video-url',
    }];
    const characters: VideoCharacter[] = [{
      id: 'char_1',
      name: '主角',
      description: 'young woman',
      referenceImageUrl: 'ref-url',
    }];

    expect(resetWorkflowGeneratedAssets(shots, characters)).toEqual({
      shots: [{
        ...shots[0],
        generated_first_frame_url: undefined,
        generated_last_frame_url: undefined,
        generated_video_url: undefined,
        suppressed_generated_urls: {
          video: 'video-url',
        },
      }],
      characters: [{
        ...characters[0],
        referenceImageUrl: undefined,
      }],
    });
  });

  it('builds stable export names and download script', () => {
    expect(getWorkflowExportIndexWidth(12)).toBe(2);
    expect(getWorkflowExportBaseName(0, 'first', 2)).toBe('01.首帧');
    expect(getWorkflowExportBaseName(9, 'video', 2)).toBe('10.视频');
    const script = buildWorkflowDownloadScript('00.manifest.json');
    expect(script).toContain('00.manifest.json');
    expect(script).toContain('download_if_missing');
  });

  it('collects exportable shot assets in display order', () => {
    const shots: VideoShot[] = [{
      id: 'shot_1',
      startTime: 0,
      endTime: 3,
      description: 'desc',
      type: 'opening',
      label: '开场',
      generated_first_frame_url: 'first-url',
      generated_video_url: 'video-url',
    }, {
      id: 'shot_2',
      startTime: 3,
      endTime: 6,
      description: 'desc',
      type: 'scene',
      label: '转场',
      generated_last_frame_url: 'last-url',
    }];

    expect(collectWorkflowExportAssets(shots)).toEqual([
      { url: 'first-url', type: 'image', kind: 'first', shotIndex: 0 },
      { url: 'video-url', type: 'video', kind: 'video', shotIndex: 0 },
      { url: 'last-url', type: 'image', kind: 'last', shotIndex: 1 },
    ]);
  });

  it('exports selected audio as mp3 when the download URL has no extension', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(new Blob(['audio-bytes'], { type: 'audio/mpeg' }))
      )
    );

    await exportWorkflowAssetsZip({
      recordId: 'mv_1',
      fileNamePrefix: 'mv',
      zipBaseName: 'mv_assets',
      scriptMarkdown: '# 爆款MV脚本',
      recordMeta: { id: 'mv_1' },
      shots: [],
      assets: [],
      audioAsset: {
        url: 'https://api.example.com/audio/download',
        fallbackExtension: 'mp3',
      },
    });

    expect(downloadFromBlobMock).toHaveBeenCalledTimes(1);
    const zipBlob = downloadFromBlobMock.mock.calls[0]?.[0];
    expect(zipBlob).toBeInstanceOf(Blob);
    if (!zipBlob) throw new Error('ZIP blob was not generated');

    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(zipBlob);

    expect(Object.keys(zip.files)).toContain('00.音乐.mp3');
    const manifestText = await zip.file('00.manifest.json')?.async('string');
    expect(manifestText).toContain('"music": "00.音乐.mp3"');
  });

  it('exports cached audio when the remote URL cannot be fetched', async () => {
    const audioUrl = 'https://cdn.example.com/audio/download?expires=1';
    const cachedResponse = new Response(
      new Blob(['cached-audio-bytes'], { type: 'audio/mpeg' })
    );
    const matchMock = vi.fn(async (request: RequestInfo | URL) => {
      const key = String(request);
      return key === 'https://cdn.example.com/audio/download'
        ? cachedResponse.clone()
        : undefined;
    });

    vi.stubGlobal('caches', {
      open: vi.fn(async () => ({
        match: matchMock,
      })),
    });
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network blocked');
    }));

    await exportWorkflowAssetsZip({
      recordId: 'mv_1',
      fileNamePrefix: 'mv',
      zipBaseName: 'mv_assets',
      scriptMarkdown: '# 爆款MV脚本',
      recordMeta: { id: 'mv_1' },
      shots: [],
      assets: [],
      audioAsset: {
        url: audioUrl,
        fallbackExtension: 'mp3',
      },
    });

    const zipBlob = downloadFromBlobMock.mock.calls[0]?.[0];
    if (!zipBlob) throw new Error('ZIP blob was not generated');

    const { default: JSZip } = await import('jszip');
    const zip = await JSZip.loadAsync(zipBlob);
    const audioFile = zip.file('00.音乐.mp3');

    expect(audioFile).not.toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
