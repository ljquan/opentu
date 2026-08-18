import { describe, expect, it } from 'vitest';
import { applyMediaModelDefaultsToArgs } from '../media-model-routing';

describe('media-model-routing', () => {
  it('为未指定模型的媒体工具注入对应默认模型和来源', () => {
    const imageRef = { profileId: 'profile-a', modelId: 'gpt-image-2' };
    const args = applyMediaModelDefaultsToArgs(
      'generate_image',
      { prompt: 'cat' },
      {
        defaultModels: { image: 'gpt-image-2' },
        defaultModelRefs: { image: imageRef },
      }
    );

    expect(args.model).toBe('gpt-image-2');
    expect(args.modelRef).toEqual(imageRef);
  });

  it('纠正媒体类型不匹配的显式模型', () => {
    const args = applyMediaModelDefaultsToArgs(
      'generate_video',
      { prompt: 'sunset', model: 'deepseek-v3.2' },
      {
        defaultModels: { video: 'seedance-1.5-pro' },
      }
    );

    expect(args.model).toBe('seedance-1.5-pro');
  });

  it('为 PPT 只同步文本模型字段', () => {
    const imageRef = { profileId: 'profile-b', modelId: 'gpt-image-2' };
    const textRef = { profileId: 'profile-text', modelId: 'deepseek-v3.2' };
    const args = applyMediaModelDefaultsToArgs(
      'generate_ppt',
      { topic: 'AI 产品' },
      {
        defaultModels: { image: 'gpt-image-2' },
        defaultModelRefs: { image: imageRef },
        contextModel: { id: 'deepseek-v3.2', type: 'text' },
        contextModelRef: textRef,
      }
    );

    expect(args.model).toBeUndefined();
    expect(args.modelRef).toBeUndefined();
    expect(args.imageModel).toBeUndefined();
    expect(args.imageModelRef).toBeUndefined();
    expect(args.textModel).toBe('deepseek-v3.2');
    expect(args.textModelRef).toEqual(textRef);
  });

  it('为 PPT 讲解视频同时注入文本、图片、音频和成片模型来源', () => {
    const textRef = { profileId: 'text-profile', modelId: 'deepseek-v3.2' };
    const imageRef = { profileId: 'image-profile', modelId: 'gpt-image-2' };
    const videoRef = {
      profileId: 'video-profile',
      modelId: 'tuzi-ppt-explainer',
    };
    const audioRef = {
      profileId: 'audio-profile',
      modelId: 'gpt-4o-mini-tts',
    };
    const args = applyMediaModelDefaultsToArgs(
      'generate_ppt_explainer_video',
      { source: 'topic', model: 'should-not-persist' },
      {
        contextModel: { id: textRef.modelId, type: 'text' },
        contextModelRef: textRef,
        defaultModels: {
          image: imageRef.modelId,
          video: videoRef.modelId,
          audio: audioRef.modelId,
        },
        defaultModelRefs: {
          image: imageRef,
          video: videoRef,
          audio: audioRef,
        },
      }
    );

    expect(args.model).toBeUndefined();
    expect(args.textModel).toBe(textRef.modelId);
    expect(args.textModelRef).toEqual(textRef);
    expect(args.imageModel).toBe(imageRef.modelId);
    expect(args.imageModelRef).toEqual(imageRef);
    expect(args.videoModel).toBe(videoRef.modelId);
    expect(args.videoModelRef).toEqual(videoRef);
    expect(args.audioModel).toBe(audioRef.modelId);
    expect(args.audioModelRef).toEqual(audioRef);
  });
});
