import {
  buildManualHttpVariables,
  buildManualHttpRequestPayload,
  getManualHttpTemplate,
  normalizeManualImageResponse,
  normalizeManualTaskResponse,
  renderTemplate,
  resolveManualHttpRequestMethod,
} from '../provider-routing/manual-http-template';
import type {
  AdapterContext,
  AudioGenerationRequest,
  AudioModelAdapter,
  ImageGenerationRequest,
  ImageModelAdapter,
  VideoGenerationRequest,
  VideoModelAdapter,
} from './types';
import { registerModelAdapter } from './registry';
import { sendAdapterRequest } from './context';
import { getFileExtension } from '@aitu/utils';
import { readProviderResponseText } from '../provider-routing';

function getTemplate(context: AdapterContext) {
  const template = getManualHttpTemplate(context.binding?.metadata);
  if (!template) {
    throw new Error('自定义模型缺少调用方法配置');
  }
  return template;
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  const text = await readProviderResponseText(response);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text || response.statusText}`);
  }
  if (!text.trim()) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function submitManualHttp(
  context: AdapterContext,
  request: {
    path: string;
    method?: string;
    headers?: Record<string, string>;
    template: NonNullable<ReturnType<typeof getManualHttpTemplate>>;
    variables: Record<string, unknown>;
  }
): Promise<unknown> {
  const payload = await buildManualHttpRequestPayload(
    request.template,
    request.variables,
    context.fetcher,
    context.signal
  );
  const headers = renderTemplate(request.headers || {}, request.variables) as
    | Record<string, string>
    | undefined;
  const response = await sendAdapterRequest(context, {
    path: renderTemplate(request.path, request.variables) as string,
    baseUrlStrategy: context.binding?.baseUrlStrategy,
    method: resolveManualHttpRequestMethod(request.template, request.method),
    headers: {
      ...(payload.contentType ? { 'Content-Type': payload.contentType } : {}),
      ...(!payload.contentType &&
      payload.body !== undefined &&
      !(payload.body instanceof FormData)
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...(headers || {}),
    },
    body: payload.body,
  });

  return parseJsonResponse(response);
}

async function pollManualTask(
  context: AdapterContext,
  taskId: string,
  variables: Record<string, unknown>,
  onProgress?: (progress: number, status?: string) => void
) {
  const template = getTemplate(context);
  const pollPath = context.binding?.pollPathTemplate;
  if (!pollPath) {
    throw new Error('自定义异步模型缺少查询路径');
  }

  const interval = 5000;
  const maxAttempts = 720;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, interval));
    const payload = await submitManualHttp(context, {
      path: pollPath,
      method: 'GET',
      headers: template.headers,
      template: {
        ...template,
        bodyType: 'none',
      },
      variables: {
        ...variables,
        taskId,
      },
    });
    const task = normalizeManualTaskResponse(
      payload,
      template.pollResponsePaths || template.pollPaths || template.responsePaths
    );
    const status = (task.status || '').toLowerCase();
    onProgress?.(task.progress ?? Math.min(10 + attempt * 2, 95), task.status);

    if (
      status === 'completed' ||
      status === 'succeeded' ||
      status === 'success' ||
      status === 'done'
    ) {
      return task;
    }

    if (status === 'failed' || status === 'error' || status === 'failure') {
      throw new Error(task.error || '自定义任务执行失败');
    }
  }

  throw new Error('自定义任务轮询超时');
}

export const customHttpImageAdapter: ImageModelAdapter = {
  id: 'custom-http-image-adapter',
  label: 'Custom HTTP Image',
  kind: 'image',
  matchProtocols: ['custom-http'],
  matchRequestSchemas: ['custom-http'],
  async generateImage(context, request: ImageGenerationRequest) {
    const template = getTemplate(context);
    const requestModelRef =
      request.modelRef ||
      (context.binding?.modelId
        ? {
            profileId: context.binding.profileId,
            modelId: context.binding.modelId,
          }
        : null);
    const variables = buildManualHttpVariables({
      model: request.model,
      modelRef: requestModelRef,
      prompt: request.prompt,
      images: request.referenceImages,
      image: request.referenceImages?.[0],
      maskImage: request.maskImage,
      size: request.size,
      params: {
        ...(request.params || {}),
        generationMode: request.generationMode,
        inputFidelity: request.inputFidelity,
        background: request.background,
        outputFormat: request.outputFormat,
        outputCompression: request.outputCompression,
      },
    });
    const submitPayload = await submitManualHttp(context, {
      path: context.binding?.submitPath || '',
      method: template.method,
      headers: template.headers,
      template,
      variables,
    });

    if (context.binding?.pollPathTemplate) {
      const submitted = normalizeManualTaskResponse(
        submitPayload,
        template.responsePaths
      );
      if (!submitted.taskId) {
        throw new Error('自定义图片任务未返回任务 ID');
      }
      const result = await pollManualTask(
        context,
        submitted.taskId,
        variables,
        request.params?.onProgress as
          | ((progress: number, status?: string) => void)
          | undefined
      );
      if (!result.resultUrl) {
        throw new Error('自定义图片任务完成但未返回结果 URL');
      }
      return normalizeManualImageResponse(
        { url: result.resultUrl, urls: result.resultUrls },
        { imageUrl: 'url', imageUrls: 'urls' }
      );
    }

    return normalizeManualImageResponse(submitPayload, template.responsePaths);
  },
};

export const customHttpVideoAdapter: VideoModelAdapter = {
  id: 'custom-http-video-adapter',
  label: 'Custom HTTP Video',
  kind: 'video',
  matchProtocols: ['custom-http'],
  matchRequestSchemas: ['custom-http'],
  async generateVideo(context, request: VideoGenerationRequest) {
    const template = getTemplate(context);
    const requestModelRef =
      request.modelRef ||
      (context.binding?.modelId
        ? {
            profileId: context.binding.profileId,
            modelId: context.binding.modelId,
          }
        : null);
    const variables = buildManualHttpVariables({
      model: request.model,
      modelRef: requestModelRef,
      prompt: request.prompt,
      images: request.referenceImages,
      image: request.referenceImages?.[0],
      size: request.size,
      duration: request.duration,
      params: request.params,
    });
    const submitPayload = await submitManualHttp(context, {
      path: context.binding?.submitPath || '',
      method: template.method,
      headers: template.headers,
      template,
      variables,
    });
    const submitted = normalizeManualTaskResponse(
      submitPayload,
      template.responsePaths
    );
    const result = submitted.resultUrl
      ? submitted
      : submitted.taskId
      ? await pollManualTask(
          context,
          submitted.taskId,
          variables,
          request.params?.onProgress as
            | ((progress: number, status?: string) => void)
            | undefined
        )
      : submitted;

    if (!result.resultUrl) {
      throw new Error('自定义视频接口未返回视频 URL');
    }

    return {
      url: result.resultUrl,
      format: 'mp4',
      duration: request.duration,
      raw: result.raw,
    };
  },
};

export const customHttpAudioAdapter: AudioModelAdapter = {
  id: 'custom-http-audio-adapter',
  label: 'Custom HTTP Audio',
  kind: 'audio',
  matchProtocols: ['custom-http'],
  matchRequestSchemas: ['custom-http'],
  async generateAudio(
    context: AdapterContext,
    request: AudioGenerationRequest
  ) {
    const template = getTemplate(context);
    const requestModelRef =
      request.modelRef ||
      (context.binding?.modelId
        ? {
            profileId: context.binding.profileId,
            modelId: context.binding.modelId,
          }
        : null);
    const variables = buildManualHttpVariables({
      model: request.model,
      modelRef: requestModelRef,
      prompt: request.prompt,
      params: {
        ...(request.params || {}),
        title: request.title,
        tags: request.tags,
        instrumental: request.instrumental,
        make_instrumental: request.instrumental,
        mv: request.mv,
        sunoAction: request.sunoAction,
        notifyHook: request.notifyHook,
        continueClipId: request.continueClipId,
        continueTaskId: request.continueTaskId,
        continueAt: request.continueAt,
        infillStartS: request.infillStartS,
        infillEndS: request.infillEndS,
      },
    });
    const submitPayload = await submitManualHttp(context, {
      path: context.binding?.submitPath || '',
      method: template.method,
      headers: template.headers,
      template,
      variables,
    });
    const submitted = normalizeManualTaskResponse(
      submitPayload,
      template.responsePaths
    );
    if (submitted.taskId && request.params?.onSubmitted) {
      (request.params.onSubmitted as (taskId: string) => void)(
        submitted.taskId
      );
    }
    const result =
      submitted.audioUrl || submitted.resultUrl
        ? submitted
        : submitted.taskId
        ? await pollManualTask(
            context,
            submitted.taskId,
            variables,
            request.params?.onProgress as
              | ((progress: number, status?: string) => void)
              | undefined
          )
        : submitted;
    const urls = [
      result.audioUrl,
      ...(result.audioUrls || []),
      result.resultUrl,
      ...(result.resultUrls || []),
    ].filter((url): url is string => Boolean(url));
    const uniqueUrls = Array.from(new Set(urls));
    const primaryUrl = uniqueUrls[0];
    if (!primaryUrl) {
      throw new Error('自定义音频接口未返回音频 URL');
    }

    const format = getFileExtension(primaryUrl) || 'mp3';
    return {
      url: primaryUrl,
      urls: uniqueUrls.length > 1 ? uniqueUrls : undefined,
      title: request.title,
      format: format === 'bin' ? 'mp3' : format,
      providerTaskId: result.taskId,
      raw: result.raw,
    };
  },
};

export function registerCustomHttpAdapters(): void {
  registerModelAdapter(customHttpImageAdapter);
  registerModelAdapter(customHttpVideoAdapter);
  registerModelAdapter(customHttpAudioAdapter);
}
