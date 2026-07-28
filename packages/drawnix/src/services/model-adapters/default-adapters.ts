import { defaultGeminiClient } from '../../utils/gemini-api';
import { asyncImageAPIService } from '../async-image-api-service';
import {
  audioAPIService,
  extractAudioGenerationResult,
} from '../audio-api-service';
import { videoAPIService } from '../video-api-service';
import { getFileExtension, normalizeImageDataUrl } from '@aitu/utils';
import {
  DEFAULT_AUDIO_MODEL_ID,
  DEFAULT_IMAGE_MODEL_ID,
  DEFAULT_VIDEO_MODEL_ID,
  AUDIO_MODELS,
  IMAGE_MODEL_MORE_OPTIONS,
  IMAGE_MODEL_VIP_OPTIONS,
  VIDEO_MODELS,
  ModelVendor,
} from '../../constants/model-config';
import type { UploadedVideoImage } from '../../types/video.types';
import type {
  AudioModelAdapter,
  AudioGenerationRequest,
  AdapterContext,
  ImageModelAdapter,
  VideoModelAdapter,
  ImageGenerationRequest,
  VideoGenerationRequest,
} from './types';
import { registerModelAdapter } from './registry';
import { registerKlingAdapter } from './kling-adapter';
import { registerHappyHorseAdapter } from './happyhorse-adapter';
import { registerMJImageAdapter } from './mj-image-adapter';
import { registerFluxAdapter } from './flux-adapter';
import { registerSeedreamAdapter } from './seedream-adapter';
import { registerSeedanceAdapter } from './seedance-adapter';
import { registerGPTImageAdapter } from './gpt-image-adapter';
import { registerTuziGPTImageAdapter } from './tuzi-gpt-image-adapter';
import { registerCustomHttpAdapters } from './custom-http-adapter';
import {
  isGPTImage2Model,
  resolveImageResolutionTier,
} from './image-size-quality-resolver';

const imageModelIds = [...IMAGE_MODEL_VIP_OPTIONS, ...IMAGE_MODEL_MORE_OPTIONS]
  .map((model) => model.id)
  .filter(
    (modelId) =>
      !modelId.startsWith('mj-') &&
      !modelId.startsWith('bfl-flux-') &&
      !modelId.startsWith('flux-kontext-') &&
      !modelId.includes('seedream') // 所有 Seedream 统一由 seedream-adapter 处理
  );

const videoModelIds = VIDEO_MODELS.map((model) => model.id).filter(
  (modelId) =>
    !modelId.startsWith('kling') &&
    !modelId.startsWith('seedance') &&
    !modelId.includes('happyhorse')
);

const audioModelIds = AUDIO_MODELS.map((model) => model.id);

function isGptImageModel(model: string): boolean {
  const lowerId = model.toLowerCase();
  return lowerId.startsWith('gpt-image') || lowerId.includes('gpt-image');
}

const extractImageUrl = (
  response: any,
  prompt: string
): { url: string; urls?: string[]; format: string; raw?: unknown } => {
  if (
    response?.data &&
    Array.isArray(response.data) &&
    response.data.length > 0
  ) {
    const imageData = response.data[0];
    const urls = response.data
      .map(
        (item: any) =>
          item?.url ||
          (item?.b64_json
            ? `data:image/png;base64,${item.b64_json}`
            : undefined)
      )
      .filter(Boolean) as string[];
    const format = getFileExtension(urls[0]) || 'png';
    if (imageData.url) {
      return {
        url: normalizeImageDataUrl(imageData.url),
        urls,
        format: format === 'bin' ? 'png' : format,
        raw: response,
      };
    }
    if (imageData.b64_json) {
      const normalizedUrl = normalizeImageDataUrl(imageData.b64_json);
      return {
        url: normalizedUrl,
        urls,
        format: format === 'bin' ? 'png' : format,
        raw: response,
      };
    }
  }

  const message = response?.revised_prompt
    ? String(response.revised_prompt).replace(
        `Generate an image: ${prompt}: `,
        ''
      )
    : JSON.stringify(response);

  throw new Error(`API 未返回有效的图片数据: ${message}`);
};

const toUploadedVideoImages = (
  referenceImages?: string[]
): UploadedVideoImage[] | undefined => {
  if (!referenceImages || referenceImages.length === 0) {
    return undefined;
  }

  return referenceImages.map((url, index) => ({
    slot: index,
    url,
    name: `reference-${index + 1}.png`,
  }));
};

function shouldUseAsyncImageEndpoint(
  context: AdapterContext,
  _model: string
): boolean {
  return (
    context.binding?.protocol === 'openai.async.media' ||
    context.binding?.requestSchema === 'openai.async.image.form'
  );
}

export const geminiImageAdapter: ImageModelAdapter = {
  id: 'gemini-image-adapter',
  label: 'Gemini Image',
  kind: 'image',
  docsUrl: 'https://tuzi-api.apifox.cn',
  matchProtocols: [
    'openai.images.generations',
    'openai.async.media',
    'google.generateContent',
  ],
  matchRequestSchemas: [
    'openai.image.basic-json',
    'openai.async.image.form',
    'google.generate-content.image-inline',
  ],
  matchVendors: [ModelVendor.GEMINI],
  supportedModels: imageModelIds,
  defaultModel: DEFAULT_IMAGE_MODEL_ID,
  async generateImage(context, request: ImageGenerationRequest) {
    const model = request.model || DEFAULT_IMAGE_MODEL_ID;

    if (shouldUseAsyncImageEndpoint(context, model)) {
      const result = await asyncImageAPIService.generateWithPolling(
        {
          model,
          modelRef: request.modelRef || null,
          prompt: request.prompt,
          size: request.size,
          referenceImages: request.referenceImages,
          maskImage: request.maskImage,
        },
        {
          interval: 5000,
          onProgress: request.params?.onProgress as
            | ((progress: number, status?: string) => void)
            | undefined,
          onSubmitted: request.params?.onSubmitted as
            | ((remoteId: string) => void)
            | undefined,
          ...(context.onSubmissionAttempt
            ? { onSubmissionAttempt: context.onSubmissionAttempt }
            : {}),
          requestId: context.requestId,
          signal: context.signal,
        }
      );
      const { url, format } = asyncImageAPIService.extractUrlAndFormat(result);
      return { url, format, raw: result };
    }

    const quality =
      resolveImageResolutionTier(request.params) ||
      (isGPTImage2Model(model) ? '1k' : undefined);
    const responseFormat = request.params?.response_format as
      | 'url'
      | 'b64_json'
      | undefined;

    const imageOptions: Parameters<
      typeof defaultGeminiClient.generateImage
    >[1] = {
      size: request.size,
      image: request.referenceImages,
      omitDefaultResponseFormat: isGptImageModel(model),
      quality,
      count:
        typeof request.params?.n === 'number' ? request.params.n : undefined,
      model,
      modelRef: request.modelRef || null,
      requestId: context.requestId,
      signal: context.signal,
      ...(context.onSubmissionAttempt
        ? { onSubmissionAttempt: context.onSubmissionAttempt }
        : {}),
    };
    if (responseFormat) {
      imageOptions.response_format = responseFormat;
    }

    const result = await defaultGeminiClient.generateImage(
      request.prompt,
      imageOptions
    );

    return extractImageUrl(result, request.prompt);
  },
};

export const geminiVideoAdapter: VideoModelAdapter = {
  id: 'gemini-video-adapter',
  label: 'Gemini Video',
  kind: 'video',
  docsUrl: 'https://tuzi-api.apifox.cn',
  matchProtocols: ['openai.async.video'],
  matchRequestSchemas: ['openai.video.form-input-reference'],
  matchPredicate(modelConfig) {
    if (modelConfig.type !== 'video') {
      return false;
    }
    const lowerId = modelConfig.id.toLowerCase();
    return (
      !lowerId.includes('kling') &&
      !lowerId.includes('seedance') &&
      !lowerId.includes('happyhorse')
    );
  },
  supportedModels: videoModelIds,
  defaultModel: DEFAULT_VIDEO_MODEL_ID,
  async generateVideo(_context, request: VideoGenerationRequest) {
    const model = (request.model || DEFAULT_VIDEO_MODEL_ID) as any;
    const durationEncoded =
      model && model.startsWith('sora-2-') && /\d+s$/.test(model);
    const adapterParams = request.params
      ? Object.fromEntries(
          Object.entries(request.params).filter(
            ([key]) => key !== 'onProgress' && key !== 'onSubmitted'
          )
        )
      : undefined;
    const seconds = durationEncoded
      ? undefined
      : request.duration
      ? String(request.duration)
      : model?.toString().startsWith('sora')
      ? undefined
      : '8';
    const size = request.size || '1280x720';
    const inputReferences = toUploadedVideoImages(request.referenceImages);

    const result = await videoAPIService.generateVideoWithPolling(
      {
        model,
        modelRef: request.modelRef || null,
        prompt: request.prompt,
        seconds,
        size,
        inputReferences,
        params: adapterParams,
      },
      {
        interval: 5000,
        onProgress: request.params?.onProgress as
          | ((progress: number, status?: string) => void)
          | undefined,
        onSubmitted: request.params?.onSubmitted as
          | ((videoId: string) => void)
          | undefined,
      }
    );

    const url = result.video_url || result.url;
    if (!url) {
      throw new Error('API 未返回有效的视频 URL');
    }

    return {
      url,
      format: 'mp4',
      duration: parseInt(result.seconds || seconds || '0', 10),
      raw: result,
    };
  },
};

export const sunoAudioAdapter: AudioModelAdapter = {
  id: 'suno-audio-adapter',
  label: 'Suno Audio',
  kind: 'audio',
  docsUrl: 'https://tuzi-api.apifox.cn',
  matchProtocols: ['tuzi.suno.music'],
  matchRequestSchemas: ['tuzi.suno.music.submit'],
  matchModels: ['suno_music'],
  matchTags: ['suno', 'audio', 'music'],
  supportedModels: audioModelIds,
  defaultModel: DEFAULT_AUDIO_MODEL_ID,
  async generateAudio(_context, request: AudioGenerationRequest) {
    const result = await audioAPIService.generateAudioWithPolling(
      {
        model: request.model || DEFAULT_AUDIO_MODEL_ID,
        modelRef: request.modelRef || null,
        prompt: request.prompt,
        title: request.title,
        tags: request.tags,
        mv: request.mv,
        sunoAction: request.sunoAction,
        notifyHook: request.notifyHook,
        continueClipId: request.continueClipId,
        continueTaskId: request.continueTaskId,
        continueAt: request.continueAt,
        infillStartS: request.infillStartS,
        infillEndS: request.infillEndS,
        params: request.params,
      },
      {
        interval: 5000,
        onProgress: request.params?.onProgress as
          | ((progress: number, status?: string) => void)
          | undefined,
        onSubmitted: request.params?.onSubmitted as
          | ((taskId: string) => void)
          | undefined,
      }
    );

    return extractAudioGenerationResult(result);
  },
};

export function registerDefaultModelAdapters(): void {
  registerCustomHttpAdapters();
  registerGPTImageAdapter();
  registerTuziGPTImageAdapter();
  registerModelAdapter(geminiImageAdapter);
  registerHappyHorseAdapter();
  registerModelAdapter(geminiVideoAdapter);
  registerModelAdapter(sunoAudioAdapter);
  registerKlingAdapter();
  registerMJImageAdapter();
  registerFluxAdapter();
  registerSeedreamAdapter();
  registerSeedanceAdapter();
}
