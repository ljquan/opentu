/**
 * Gemini API 服务函数
 */

import {
  ImageInput,
  GeminiMessage,
  VideoGenerationOptions,
  ProcessedContent,
  GeminiResponse,
} from './types';
import {
  DEFAULT_CONFIG,
  VIDEO_DEFAULT_CONFIG,
  shouldUseNonStreamMode,
} from './config';
import { prepareImageData, processMixedContent } from './utils';
import {
  callApiWithRetry,
  callApiStreamRaw,
  callVideoApiStreamRaw,
} from './apiCalls';
import {
  resolveInvocationRoute,
  settingsManager,
  type ModelRef,
} from '../settings-manager';
import { validateAndEnsureConfig } from './auth';
import {
  startLLMApiLog,
  completeLLMApiLog,
  failLLMApiLog,
} from '../../services/media-executor/llm-api-logger';

/**
 * 调用 Gemini API 进行图像生成
 * 使用专用的 /v1/images/generations 接口
 * 不再依赖 SW 任务队列，直接在主线程 fetch
 */
export async function generateImageWithGemini(
  prompt: string,
  options: {
    size?: string;
    image?: string | string[]; // 支持单图或多图
    response_format?: 'url' | 'b64_json';
    quality?: '1k' | '2k' | '4k';
    model?: string; // 支持指定模型
    modelRef?: ModelRef | null;
  } = {}
): Promise<any> {
  // 等待设置管理器初始化完成
  await settingsManager.waitForInitialization();

  const routeModel = options.modelRef || options.model;
  const route = resolveInvocationRoute('image', routeModel);
  const modelName =
    route.modelId ||
    DEFAULT_CONFIG.modelName ||
    'gemini-3-pro-image-preview-vip';

  return generateImageDirect(prompt, options, modelName, routeModel);
}

// generateImageViaSW 已移除 - 不再依赖 SW 任务队列

/**
 * 使用 fetch 生成图片
 */
async function generateImageDirect(
  prompt: string,
  options: {
    size?: string;
    image?: string | string[];
    response_format?: 'url' | 'b64_json';
    quality?: '1k' | '2k' | '4k';
    model?: string;
    modelRef?: ModelRef | null;
  },
  modelName: string,
  routeModel?: string | ModelRef | null
): Promise<any> {
  const route = resolveInvocationRoute('image', routeModel || modelName);
  const startTime = Date.now();

  // 开始记录 LLM API 调用（降级模式）
  const referenceImages = options.image
    ? Array.isArray(options.image)
      ? options.image
      : [options.image]
    : undefined;
  const logId = startLLMApiLog({
    endpoint: '/images/generations',
    model: modelName,
    taskType: 'image',
    prompt,
    hasReferenceImages: referenceImages && referenceImages.length > 0,
    referenceImageCount: referenceImages?.length,
  });

  const config = {
    ...DEFAULT_CONFIG,
    apiKey: route.apiKey,
    baseUrl: route.baseUrl,
    modelName,
  };

  try {
    const validatedConfig = await validateAndEnsureConfig(config);
    const headers = {
      Authorization: `Bearer ${validatedConfig.apiKey}`,
      'Content-Type': 'application/json',
    };

    // 构建请求体 - 强调生成图片
    const enhancedPrompt = `Generate an image: ${prompt}`;
    const data: any = {
      model: validatedConfig.modelName || 'gemini-3-pro-image-preview-vip',
      prompt: enhancedPrompt,
      response_format: options.response_format || 'url', // 默认返回 url
    };

    // size 参数可选，不传则由 API 自动决定（对应 auto）
    if (options.size && options.size !== 'auto') {
      data.size = options.size;
    }

    // image 参数可选（单图或多图）
    if (options.image) {
      data.image = options.image;
    }

    // quality 参数可选
    if (options.quality) {
      data.quality = options.quality;
    }

    const url = `${validatedConfig.baseUrl}/images/generations`;

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(
        validatedConfig.timeout || DEFAULT_CONFIG.timeout!
      ),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[ImageAPI] Request failed:', response.status, errorText);
      const duration = Date.now() - startTime;
      failLLMApiLog(logId, {
        httpStatus: response.status,
        duration,
        errorMessage: errorText.substring(0, 500),
      });
      const error = new Error(
        `图片生成请求失败: ${response.status} - ${errorText}`
      );
      (error as any).apiErrorBody = errorText;
      (error as any).httpStatus = response.status;
      throw error;
    }

    const result = await response.json();
    const duration = Date.now() - startTime;

    // 提取结果 URL
    const resultUrl = result.data?.[0]?.url || result.data?.[0]?.b64_json;

    completeLLMApiLog(logId, {
      httpStatus: response.status,
      duration,
      resultType: 'image',
      resultCount: result.data?.length || 1,
      resultUrl: resultUrl?.substring(0, 200),
    });

    return result;
  } catch (error: any) {
    const duration = Date.now() - startTime;
    // 如果错误还没被记录（非 HTTP 错误）
    if (!error.httpStatus) {
      failLLMApiLog(logId, {
        duration,
        errorMessage: error.message || 'Image generation failed',
      });
    }
    throw error;
  }
}

/**
 * 调用 Gemini API 进行视频生成
 */
export async function generateVideoWithGemini(
  prompt: string,
  image: ImageInput | null,
  options: VideoGenerationOptions = {}
): Promise<{
  response: GeminiResponse;
  processedContent: ProcessedContent;
}> {
  // 等待设置管理器初始化完成
  await settingsManager.waitForInitialization();
  const route = resolveInvocationRoute('video');
  const config = {
    ...VIDEO_DEFAULT_CONFIG,
    apiKey: route.apiKey,
    baseUrl: route.baseUrl,
    modelName: route.modelId || VIDEO_DEFAULT_CONFIG.modelName,
  };
  const validatedConfig = await validateAndEnsureConfig(config);

  // 准备图片数据（现在是可选的）
  let imageContent;
  if (image) {
    try {
      // console.log('处理视频生成源图片...');
      const imageData = await prepareImageData(image);
      imageContent = {
        type: 'image_url' as const,
        image_url: {
          url: imageData,
        },
      };
      // console.log('视频生成源图片处理完成');
    } catch (error) {
      console.error('处理源图片时出错:', error);
      throw error;
    }
  } else {
    // console.log('无源图片，使用纯文本生成视频');
  }

  // 构建视频生成专用的提示词（根据是否有图片使用不同提示词）
  const videoPrompt = image
    ? `Generate a video based on this image and description: "${prompt}"`
    : `Generate a video based on this description: "${prompt}"`;

  // 构建消息内容（只有在有图片时才包含图片）
  const contentList =
    image && imageContent
      ? [{ type: 'text' as const, text: videoPrompt }, imageContent]
      : [{ type: 'text' as const, text: videoPrompt }];

  const messages: GeminiMessage[] = [
    {
      role: 'user',
      content: contentList,
    },
  ];

  // console.log('开始调用视频生成API...');

  // 使用专用的视频生成流式调用
  const response = await callVideoApiStreamRaw(
    validatedConfig,
    messages,
    options
  );

  // 处理响应内容
  const responseContent = response.choices[0]?.message?.content || '';
  const processedContent = processMixedContent(responseContent);

  return {
    response,
    processedContent,
  };
}

/**
 * 调用 Gemini API 进行聊天对话（支持图片输入）
 */
export async function chatWithGemini(
  prompt: string,
  images: ImageInput[] = [],
  onChunk?: (content: string) => void
): Promise<{
  response: GeminiResponse;
  processedContent: ProcessedContent;
}> {
  // 等待设置管理器初始化完成
  await settingsManager.waitForInitialization();
  const route = resolveInvocationRoute(images.length > 0 ? 'image' : 'text');
  const config = {
    ...DEFAULT_CONFIG,
    apiKey: route.apiKey,
    baseUrl: route.baseUrl,
    modelName: route.modelId || DEFAULT_CONFIG.modelName,
  };
  const validatedConfig = await validateAndEnsureConfig(config);

  // 准备图片数据
  const imageContents = [];
  for (let i = 0; i < images.length; i++) {
    try {
      // console.log(`处理第 ${i + 1} 张图片...`);
      const imageData = await prepareImageData(images[i]);
      imageContents.push({
        type: 'image_url' as const,
        image_url: {
          url: imageData,
        },
      });
    } catch (error) {
      console.error(`处理第 ${i + 1} 张图片时出错:`, error);
      throw error;
    }
  }

  // 构建消息内容
  const contentList = [
    { type: 'text' as const, text: prompt },
    ...imageContents,
  ];

  const messages: GeminiMessage[] = [
    {
      role: 'user',
      content: contentList,
    },
  ];

  // console.log(`共发送 ${imageContents.length} 张图片到 Gemini API`);

  // 根据模型选择流式或非流式调用
  let response: GeminiResponse;
  const modelName = validatedConfig.modelName || '';

  if (shouldUseNonStreamMode(modelName)) {
    // 某些模型（如 seedream）在流式模式下可能返回不完整响应，使用非流式调用
    // console.log(`模型 ${modelName} 使用非流式调用确保响应完整`);
    response = await callApiWithRetry(validatedConfig, messages);
    // Non-stream mode simulates one chunk at the end if callback is provided
    if (onChunk && response.choices[0]?.message?.content) {
      onChunk(response.choices[0].message.content);
    }
  } else if (images.length > 0 || onChunk) {
    // 其他模型：图文混合或明确要求流式（提供了 onChunk）使用流式调用
    // console.log('使用流式调用');
    response = await callApiStreamRaw(validatedConfig, messages, onChunk);
  } else {
    // 纯文本且无流式回调，可以使用非流式调用
    response = await callApiWithRetry(validatedConfig, messages);
  }

  // 处理响应内容
  const responseContent = response.choices[0]?.message?.content || '';
  const processedContent = processMixedContent(responseContent);

  return {
    response,
    processedContent,
  };
}

/**
 * 发送多轮对话消息
 * @param messages 消息列表
 * @param onChunk 流式回调
 * @param signal 取消信号
 * @param temporaryModel 临时模型引用（仅在当前会话中使用，不影响全局设置）
 */
export async function sendChatWithGemini(
  messages: GeminiMessage[],
  onChunk?: (content: string) => void,
  signal?: AbortSignal,
  temporaryModel?: string | ModelRef | null
): Promise<GeminiResponse> {
  console.log('[sendChatWithGemini] 开始, temporaryModel:', temporaryModel);

  // 等待设置管理器初始化完成
  const t0 = Date.now();
  await settingsManager.waitForInitialization();
  console.log(
    '[sendChatWithGemini] settingsManager 初始化完成, 耗时:',
    Date.now() - t0,
    'ms'
  );
  const route = resolveInvocationRoute('text', temporaryModel);
  const config = {
    ...DEFAULT_CONFIG,
    apiKey: route.apiKey,
    baseUrl: route.baseUrl,
    modelName: route.modelId || 'gpt-4o-mini',
  };
  console.log('[sendChatWithGemini] 配置:', {
    modelName: config.modelName,
    hasApiKey: !!config.apiKey,
    baseUrl: config.baseUrl,
  });

  const t1 = Date.now();
  const validatedConfig = await validateAndEnsureConfig(config);
  console.log(
    '[sendChatWithGemini] validateAndEnsureConfig 完成, 耗时:',
    Date.now() - t1,
    'ms'
  );

  // Use stream if callback provided
  if (onChunk) {
    console.log('[sendChatWithGemini] 使用流式调用 callApiStreamRaw');
    return await callApiStreamRaw(validatedConfig, messages, onChunk, signal);
  } else {
    console.log('[sendChatWithGemini] 使用非流式调用 callApiWithRetry');
    // Note: callApiWithRetry doesn't support signal yet, but for now ChatService uses onChunk
    return await callApiWithRetry(validatedConfig, messages);
  }
}
