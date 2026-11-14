import { describe, expect, it } from 'vitest';
import {
  parseAIInput,
  type SelectionInfo,
} from '../../../utils/ai-input-parser';
import { convertDirectGenerationToWorkflow } from '../workflow-converter';
import { buildTuziVideoRequest } from '../../../services/tuzi-video-request';

import { getTuziVideoComposerParams } from '../../../constants/tuzi-video-models';

const createSelection = (
  texts: string[] = [],
  imageCount = 0
): SelectionInfo => ({
  texts,
  images: new Array(imageCount).fill('https://media.example.test/a.png'),
  videos: [],
  audios: [],
  graphics: [],
});

describe('Tuzi input to workflow', () => {
  it('keeps native Tuzi resolution enums and smart duration during input parsing', () => {
    const parsed = parseAIInput('animate', createSelection(), {
      modelId: 'wan3.0-video',
      generationType: 'video',
      params: { size: '480P', duration: '-1', audio: 'false' },
    });
    expect(parsed).toMatchObject({
      size: '480P',
      duration: '-1',
      extraParams: { audio: 'false' },
    });
    const omni = parseAIInput('animate', createSelection(), {
      modelId: 'gemini-omni-1.2-flash',
      generationType: 'video',
      params: { size: '1080x1920' },
    });
    expect(omni).toMatchObject({
      size: '1080p',
      extraParams: { ratio: '9:16' },
    });
  });
  it('keeps HappyHorse I2V image-only requests free of an invented prompt', () => {
    const parsed = parseAIInput('', createSelection([], 1), {
      modelId: 'happyhorse-1.1-i2v',
      generationType: 'video',
    });
    expect(parsed.prompt).toBe('');
  });

  it.each([
    ['gemini-omni-1.2-flash', 'video'],
    ['wan3.0-video', 'reference_videos'],
    ['kling-4.0', 'feature_video'],
  ])(
    'keeps selected video roles through the %s workflow and wire body',
    async (modelId, role) => {
      const selection = {
        ...createSelection(),
        videos: ['https://media.example.test/a.mp4'],
      };
      const parsed = parseAIInput('animate', selection, {
        modelId,
        generationType: 'video',
        params: { reference_mode: 'mixed', duration: '3' },
      });
      const workflow = convertDirectGenerationToWorkflow(parsed, []);
      const args = workflow.steps[0].args;
      expect(
        JSON.parse(String((args.params as Record<string, unknown>).video_media))
      ).toEqual([{ type: role, url: 'https://media.example.test/a.mp4' }]);
      const body = await buildTuziVideoRequest({
        model: modelId,
        prompt: String(args.prompt),
        duration: String(args.seconds),
        size: args.size as string,
        params: args.params as Record<string, unknown>,
      });
      if (modelId.startsWith('gemini'))
        expect(body?.input).toContainEqual({
          type: 'video',
          mime_type: 'video/mp4',
          uri: selection.videos[0],
        });
      else if (modelId.startsWith('wan'))
        expect(body?.reference_videos).toEqual(selection.videos);
      else
        expect(body?.contents).toContainEqual({
          type: 'feature_video',
          id: 'media_1',
          url: selection.videos[0],
        });
    }
  );
  it('preserves typed false, zero and structured media in programmatic workflows', async () => {
    const parsed = parseAIInput('animate', createSelection(), {
      modelId: 'wan3.0-video',
      generationType: 'video',
      params: { size: '480P', duration: '3' },
    });
    parsed.extraParams = {
      audio: false,
      seed: 0,
      reference_mode: 'mixed',
      video_media: [
        { type: 'reference_images', url: 'https://media.example.test/a.png' },
      ],
    };
    const args = convertDirectGenerationToWorkflow(parsed).steps[0].args;
    expect(args.params).toMatchObject({ audio: false, seed: 0 });
    expect(
      await buildTuziVideoRequest({
        model: String(args.model),
        prompt: String(args.prompt),
        duration: String(args.seconds),
        size: String(args.size),
        params: args.params as Record<string, unknown>,
      })
    ).toMatchObject({
      audio: false,
      seed: 0,
      reference_images: ['https://media.example.test/a.png'],
    });
  });
  it('keeps image-only I2V empty through workflow construction', () => {
    const selection = createSelection([], 1);
    const parsed = parseAIInput('', selection, {
      modelId: 'happyhorse-1.1-i2v',
      generationType: 'video',
    });
    const args = convertDirectGenerationToWorkflow(parsed, selection.images)
      .steps[0].args;
    expect(args.prompt).toBe('');
    expect(args.referenceImages).toEqual(selection.images);
  });
});


describe('automatic composer references', () => {
  it.each([
    ['empty', 0, false, false],
    ['single image', 1, false, false],
    ['two frames', 2, false, false],
    ['three images', 3, false, false],
    ['image and video', 1, true, false],
    ['image and audio', 1, false, true],
  ])('maps Wan %s without using saved references or modes', async (_, imageCount, video, audio) => {
    const selection = {
      ...createSelection(),
      images: Array.from({ length: Number(imageCount) }, (_, i) => `https://media.example.test/${i}.png`),
      videos: video ? ['https://media.example.test/a.mp4'] : [],
      audios: audio ? ['https://media.example.test/a.mp3'] : [],
    };
    const saved = { video_media: 'invalid old draft', reference_mode: 'frames', size: '480P', duration: '2', audio: 'false' };
    const parsed = parseAIInput('animate', selection, {
      modelId: 'wan3.0-video', generationType: 'video',
      params: getTuziVideoComposerParams('wan3.0-video', saved),
    });
    const args = convertDirectGenerationToWorkflow(parsed, selection.images).steps[0].args;
    const body = await buildTuziVideoRequest({
      model: String(args.model), prompt: String(args.prompt),
      duration: String(args.seconds), size: String(args.size),
      referenceImages: args.referenceImages as string[],
      params: args.params as Record<string, unknown>,
    });
    expect(body).toMatchObject({ duration: 2, resolution: '480P', audio: false });
    const mixed = Number(imageCount) > 2 || video || audio;
    if (mixed) {
      expect(body).not.toHaveProperty('first_frame');
      expect(body?.reference_images).toEqual(selection.images);
    } else if (imageCount) {
      expect(body?.first_frame).toBe(selection.images[0]);
      expect(body?.last_frame).toBe(selection.images[1]);
      expect(body).not.toHaveProperty('reference_images');
    } else {
      expect(body).not.toHaveProperty('first_frame');
      expect(body).not.toHaveProperty('reference_images');
    }
    expect(body?.reference_videos).toEqual(video ? selection.videos : undefined);
    expect(body?.reference_audio).toEqual(audio ? selection.audios : undefined);
    expect(saved.video_media).toBe('invalid old draft');
  });
});
