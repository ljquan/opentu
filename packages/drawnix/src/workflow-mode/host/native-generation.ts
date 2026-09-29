import type {
  GenerationRequest,
  GenerationResult,
} from '../shared/generation-bridge';
import { readNativeModels } from './native-models';
import {
  resolveNativeParameters,
  validateNativeReferences,
} from '../shared/native-parameters';

export async function generateNative(
  request: GenerationRequest,
  signal: AbortSignal
): Promise<GenerationResult> {
  const catalog = await readNativeModels();
  signal.throwIfAborted();
  const channel = catalog.channels.find(
    (item) => item.id === request.channelId
  );
  const model = channel?.models.find(
    (model) =>
      model.name === request.model && model.capability === request.capability
  );
  if (!channel || !model)
    throw new Error('模型或渠道已不可用，请重新打开工作流。');
  if (model.unavailableReason) throw new Error(model.unavailableReason);
  const legacyValues = Object.fromEntries(
    Object.entries({
      size: request.size,
      quality: request.quality,
      n: request.count,
      duration:
        request.duration === undefined ? undefined : String(request.duration),
      background: request.background,
      voice: request.voice,
      response_format: request.format,
      speed: request.speed === undefined ? undefined : Number(request.speed),
      resolution: request.resolution,
      aspect_ratio: request.aspectRatio,
      generate_audio: request.generateAudio,
      watermark: request.watermark,
    }).filter(([, value]) => value !== undefined)
  ) as Record<string, string | number | boolean>;
  const supplied = { ...(request.params ?? legacyValues) };
  if (
    model.adapterId === 'kling-video-adapter' &&
    model.parameters?.some((parameter) => parameter.id === 'klingAction2') &&
    supplied.klingAction2 === undefined
  )
    supplied.klingAction2 = request.images.length
      ? 'image2video'
      : 'text2video';
  const params =
    model.parameters !== undefined || request.params !== undefined
      ? resolveNativeParameters(model.parameters || [], supplied)
      : undefined;
  if (model.referenceInputs)
    validateNativeReferences(model.referenceInputs, request);
  if (params?.input_fidelity !== undefined && !request.images.length)
    throw new Error('输入保真度需要参考图片');
  if (
    params?.output_compression !== undefined &&
    !['jpeg', 'webp'].includes(String(params.output_format))
  )
    throw new Error('压缩质量仅适用于 JPEG 或 WebP 输出');
  if (params?.background === 'transparent' && params.output_format === 'jpeg')
    throw new Error('透明背景需要 PNG 或 WebP 输出');
  if (params?.klingAction2 === 'text2video' && request.images.length)
    throw new Error('文生视频模式不接受参考图片');
  if (params?.klingAction2 === 'image2video' && !request.images.length)
    throw new Error('图生视频模式需要参考图片');
  if (
    model.parameters?.find((parameter) => parameter.id === 'size')
      ?.valueType === 'string' &&
    params?.size !== undefined &&
    !/^\d+x\d+$/.test(String(params.size))
  )
    throw new Error('图片尺寸应为宽x高');
  const modelRef = {
    profileId: channel.opentuProfileId ?? null,
    modelId: request.model,
  };
  if (request.capability === 'text') {
    const { fallbackMediaExecutor } = await import(
      '../../services/media-executor/fallback-executor'
    );
    const result = await fallbackMediaExecutor.generateText(
      {
        prompt: request.prompt,
        model: request.model,
        modelRef,
        referenceImages: request.images,
        messages: request.messages,
        params,
      },
      { signal }
    );
    signal.throwIfAborted();
    return { text: result.content, resultKind: 'text' };
  }
  const {
    resolveAdapterForInvocation,
    getAdapterContextFromSettings,
    GPT_IMAGE_EDIT_REQUEST_SCHEMAS,
  } = await import('../../services/model-adapters');
  const options =
    request.capability === 'image' && request.images.length
      ? { preferredRequestSchema: GPT_IMAGE_EDIT_REQUEST_SCHEMAS }
      : {};
  const adapter = resolveAdapterForInvocation(
    request.capability,
    request.model,
    modelRef,
    options
  );
  const context = {
    ...getAdapterContextFromSettings(request.capability, modelRef, options),
    signal,
  };
  signal.throwIfAborted();
  const common = {
    prompt: request.prompt,
    model: request.model,
    modelRef,
    referenceImages: request.images,
    size: params?.size !== undefined ? String(params.size) : request.size,
  };
  if (adapter?.kind === 'image' && request.capability === 'image') {
    const result = await adapter.generateImage(context, {
      ...common,
      generationMode: request.images.length
        ? 'image_to_image'
        : 'text_to_image',
      background:
        (params?.background as typeof request.background) ?? request.background,
      outputFormat: params?.output_format as
        | 'png'
        | 'jpeg'
        | 'webp'
        | undefined,
      outputCompression: params?.output_compression as number | undefined,
      inputFidelity: params?.input_fidelity as 'high' | 'low' | undefined,
      params: params ?? {
        quality: request.quality,
        n: request.count,
        count: request.count,
      },
    });
    signal.throwIfAborted();
    return {
      urls: result.urls?.length ? result.urls : [result.url],
      resultKind: 'image',
    };
  }
  if (adapter?.kind === 'video' && request.capability === 'video') {
    const size = params
      ? common.size
      : adapter.id === 'seedance-video-adapter'
      ? `${request.resolution || '720p'}@${request.aspectRatio || '16:9'}`
      : request.size;
    const mediaParams = {
      ...(params ?? {
        aspect_ratio: request.aspectRatio,
        resolution: request.resolution,
        generate_audio: request.generateAudio,
        watermark: request.watermark,
      }),
      ...(request.videos?.length
        ? { input_videos: request.videos, input_video: request.videos[0] }
        : {}),
      ...(request.audios?.length ? { input_audios: request.audios } : {}),
    };
    const result = await adapter.generateVideo(context, {
      ...common,
      size,
      duration:
        params?.duration !== undefined
          ? Number(params.duration)
          : request.duration,
      params: mediaParams,
    });
    signal.throwIfAborted();
    return { urls: [result.url], resultKind: 'video' };
  }
  if (adapter?.kind === 'audio' && request.capability === 'audio') {
    const result = await adapter.generateAudio(context, {
      ...common,
      title: params?.title as string | undefined,
      tags: params?.tags as string | undefined,
      mv: params?.mv as string | undefined,
      sunoAction: params?.sunoAction as string | undefined,
      instrumental:
        params?.instrumental === undefined
          ? undefined
          : String(params.instrumental) === 'true',
      continueClipId: params?.continueClipId as string | undefined,
      continueTaskId: params?.continueTaskId as string | undefined,
      continueAt: params?.continueAt as number | undefined,
      infillStartS: params?.infillStartS as number | undefined,
      infillEndS: params?.infillEndS as number | undefined,
      params: params ?? {
        voice: request.voice,
        response_format: request.format,
        speed: Number(request.speed || 1),
      },
    });
    signal.throwIfAborted();
    if (result.resultKind === 'lyrics')
      return { text: result.lyricsText || '', resultKind: 'lyrics' };
    return {
      urls: result.urls?.length ? result.urls : [result.url],
      resultKind: 'audio',
    };
  }
  throw new Error('OpenTu 暂无此模型的生成适配器，请检查渠道绑定。');
}
