/**
 * Gemini API 调用函数
 *
 * 所有 API 请求在主线程直接发起。
 */

import type { ResolvedProviderContext } from '../../services/provider-routing';
import { providerTransport } from '../../services/provider-routing';
import {
  GeminiConfig,
  GeminiMessage,
  GeminiResponse,
  VideoGenerationOptions,
} from './types';
import { DEFAULT_CONFIG, VIDEO_DEFAULT_CONFIG } from './config';
import { analytics } from '../posthog-analytics';

type GoogleInlineData = {
  mime_type?: string;
  mimeType?: string;
  data?: string;
};

function isGoogleGenerateContentProtocol(config: GeminiConfig): boolean {
  return config.protocol === 'google.generateContent';
}

function buildProviderContext(config: GeminiConfig): ResolvedProviderContext {
  return (
    config.provider || {
      profileId: 'runtime',
      profileName: 'Runtime',
      providerType: config.providerType || 'custom',
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      authType: config.authType || 'bearer',
      extraHeaders: config.extraHeaders,
    }
  );
}

function resolveBindingPath(
  pathTemplate: string | null | undefined,
  model: string
): string {
  const template = pathTemplate?.trim();
  if (!template) {
    return `/v1beta/models/${model}:generateContent`;
  }

  return template.replace(/\{model\}/g, model);
}

function buildGoogleEndpoint(config: GeminiConfig, model: string, stream: boolean): string {
  const submitPath = resolveBindingPath(config.binding?.submitPath, model);
  if (!stream) {
    return submitPath;
  }

  if (submitPath.endsWith(':streamGenerateContent')) {
    return submitPath;
  }

  if (submitPath.endsWith(':generateContent')) {
    return `${submitPath.slice(0, -':generateContent'.length)}:streamGenerateContent`;
  }

  return `/v1beta/models/${model}:streamGenerateContent`;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.readAsDataURL(blob);
  });
}

function parseDataUrl(dataUrl: string): { mimeType: string; data: string } {
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) {
    throw new Error('Invalid data URL');
  }

  return {
    mimeType: match[1] || 'image/png',
    data: match[2] || '',
  };
}

async function toGoogleInlineData(url: string): Promise<GoogleInlineData> {
  if (url.startsWith('data:')) {
    const parsed = parseDataUrl(url);
    return {
      mime_type: parsed.mimeType,
      data: parsed.data,
    };
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load image input: ${response.status}`);
  }

  const blob = await response.blob();
  const dataUrl = await blobToDataUrl(blob);
  const parsed = parseDataUrl(dataUrl);
  return {
    mime_type: parsed.mimeType,
    data: parsed.data,
  };
}

async function buildGoogleParts(
  messages: GeminiMessage[]
): Promise<{
  contents: Array<{ role: 'user' | 'model'; parts: Array<Record<string, unknown>> }>;
  systemInstruction?: { parts: Array<{ text: string }> };
}> {
  const contents: Array<{
    role: 'user' | 'model';
    parts: Array<Record<string, unknown>>;
  }> = [];
  const systemTexts: string[] = [];

  for (const message of messages) {
    const parts: Array<Record<string, unknown>> = [];

    for (const part of message.content) {
      if (part.type === 'text' && part.text) {
        parts.push({ text: part.text });
      } else if (part.type === 'image_url' && part.image_url?.url) {
        parts.push({
          inline_data: await toGoogleInlineData(part.image_url.url),
        });
      }
    }

    if (message.role === 'system') {
      parts.forEach((part) => {
        if (typeof part.text === 'string' && part.text.trim()) {
          systemTexts.push(part.text);
        }
      });
      continue;
    }

    if (parts.length === 0) {
      continue;
    }

    contents.push({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts,
    });
  }

  return {
    contents,
    systemInstruction:
      systemTexts.length > 0
        ? {
            parts: systemTexts.map((text) => ({ text })),
          }
        : undefined,
  };
}

function extractGooglePartContent(part: Record<string, any>): string {
  if (typeof part.text === 'string') {
    return part.text;
  }

  const inlineData: GoogleInlineData | undefined =
    part.inline_data || part.inlineData;
  if (inlineData?.data) {
    const mimeType = inlineData.mime_type || inlineData.mimeType || 'image/png';
    return `data:${mimeType};base64,${inlineData.data}`;
  }

  const fileData = part.file_data || part.fileData;
  const fileUri = fileData?.file_uri || fileData?.fileUri;
  if (typeof fileUri === 'string') {
    return fileUri;
  }

  return '';
}

function normalizeGoogleResponseContent(response: Record<string, any>): string {
  const candidates = Array.isArray(response.candidates) ? response.candidates : [];
  const parts = candidates.flatMap((candidate) =>
    Array.isArray(candidate?.content?.parts) ? candidate.content.parts : []
  );

  return parts
    .map((part) => extractGooglePartContent(part || {}))
    .filter(Boolean)
    .join('\n');
}

function normalizeGoogleResponse(
  response: Record<string, any>
): GeminiResponse {
  return {
    choices: [
      {
        message: {
          role: 'assistant',
          content: normalizeGoogleResponseContent(response),
        },
      },
    ],
  };
}

export function normalizeGoogleImageResponse(
  response: Record<string, any>
): {
  data: Array<{ b64_json?: string; url?: string; mime_type?: string }>;
  raw: Record<string, any>;
} {
  const candidates = Array.isArray(response.candidates) ? response.candidates : [];
  const data = candidates.flatMap((candidate) => {
    const parts = Array.isArray(candidate?.content?.parts)
      ? candidate.content.parts
      : [];

    return parts
      .map((part: Record<string, any>) => {
        const inlineData: GoogleInlineData | undefined =
          part.inline_data || part.inlineData;
        if (inlineData?.data) {
          return {
            b64_json: inlineData.data,
            mime_type: inlineData.mime_type || inlineData.mimeType || 'image/png',
          };
        }

        const fileData = part.file_data || part.fileData;
        const fileUri = fileData?.file_uri || fileData?.fileUri;
        if (typeof fileUri === 'string') {
          return { url: fileUri };
        }

        return null;
      })
      .filter(Boolean);
  });

  return {
    data,
    raw: response,
  };
}

async function readGoogleError(response: Response): Promise<string> {
  try {
    const payload = await response.json();
    return (
      payload?.error?.message ||
      payload?.error?.status ||
      payload?.message ||
      response.statusText
    );
  } catch {
    return (await response.text().catch(() => '')) || response.statusText;
  }
}

export async function callGoogleGenerateContentRaw(
  config: GeminiConfig,
  messages: GeminiMessage[],
  options: {
    stream: boolean;
    onChunk?: (content: string) => void;
    signal?: AbortSignal;
    generationConfig?: Record<string, unknown>;
  } = { stream: false }
): Promise<GeminiResponse> {
  const startTime = Date.now();
  const model = config.modelName || 'gemini-2.0-flash';
  const endpoint = buildGoogleEndpoint(config, model, options.stream);
  const payload = await buildGoogleParts(messages);
  const requestBody: Record<string, unknown> = {
    contents: payload.contents,
  };

  if (payload.systemInstruction) {
    requestBody.systemInstruction = payload.systemInstruction;
  }

  if (options.generationConfig) {
    requestBody.generationConfig = options.generationConfig;
  }

  analytics.trackAPICallStart({
    endpoint,
    model,
    messageCount: messages.length,
    stream: options.stream,
  });

  const providerContext = buildProviderContext(config);
  const timeoutMs =
    config.timeout ||
    (options.stream ? DEFAULT_CONFIG.timeout : DEFAULT_CONFIG.timeout);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(new Error('Timeout')), timeoutMs);
  if (options.signal) {
    if (options.signal.aborted) {
      clearTimeout(timeoutId);
      controller.abort(options.signal.reason);
    } else {
      options.signal.addEventListener('abort', () => {
        clearTimeout(timeoutId);
        controller.abort(options.signal?.reason);
      });
    }
  }

  try {
    const response = await providerTransport.send(providerContext, {
      path: endpoint,
      baseUrlStrategy: config.binding?.baseUrlStrategy,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      query: options.stream ? { alt: 'sse' } : undefined,
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const duration = Date.now() - startTime;
      const errorMessage = await readGoogleError(response);
      analytics.trackAPICallFailure({
        endpoint,
        model,
        duration,
        error: errorMessage,
        httpStatus: response.status,
        stream: options.stream,
      });
      const error = new Error(`HTTP ${response.status}: ${errorMessage}`);
      (error as any).httpStatus = response.status;
      throw error;
    }

    if (!options.stream) {
      const result = (await response.json()) as Record<string, any>;
      const normalized = normalizeGoogleResponse(result);
      const duration = Date.now() - startTime;
      analytics.trackAPICallSuccess({
        endpoint,
        model,
        duration,
        responseLength: normalized.choices[0]?.message?.content?.length || 0,
        stream: false,
      });
      return normalized;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('无法获取响应流');
    }

    const decoder = new TextDecoder();
    let fullContent = '';
    let lineBuffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        const chunk = decoder.decode(value, { stream: true });
        const combined = lineBuffer + chunk;
        const lines = combined.split('\n');
        lineBuffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data: ')) {
            continue;
          }

          const rawData = trimmed.slice(6).trim();
          if (!rawData || rawData === '[DONE]') {
            continue;
          }

          try {
            const parsed = JSON.parse(rawData) as Record<string, any>;
            const chunkContent = normalizeGoogleResponseContent(parsed);
            if (!chunkContent) {
              continue;
            }

            fullContent += chunkContent;
            options.onChunk?.(fullContent);
          } catch {
            // Ignore malformed SSE chunks.
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    const duration = Date.now() - startTime;
    analytics.trackAPICallSuccess({
      endpoint,
      model,
      duration,
      responseLength: fullContent.length,
      stream: true,
    });

    return {
      choices: [
        {
          message: {
            role: 'assistant',
            content: fullContent,
          },
        },
      ],
    };
  } catch (error) {
    clearTimeout(timeoutId);
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    analytics.trackAPICallFailure({
      endpoint,
      model,
      duration,
      error: errorMessage,
      stream: options.stream,
    });
    throw error;
  }
}

/**
 * 使用原始 fetch 调用聊天 API
 */
export async function callApiRaw(
  config: GeminiConfig,
  messages: GeminiMessage[],
): Promise<GeminiResponse> {
  if (isGoogleGenerateContentProtocol(config)) {
    return callGoogleGenerateContentRaw(config, messages, {
      stream: false,
    });
  }

  const startTime = Date.now();
  const model = config.modelName || 'gemini-3-pro-image-preview-vip';
  const endpoint = '/chat/completions';

  // Track API call start
  analytics.trackAPICallStart({
    endpoint,
    model,
    messageCount: messages.length,
    stream: false,
  });

  const headers = {
    'Content-Type': 'application/json',
  };

  const data = {
    model,
    messages,
    stream: false,
  };

  try {
    const response = await providerTransport.send(buildProviderContext(config), {
      path: endpoint,
      method: 'POST',
      headers,
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(config.timeout || DEFAULT_CONFIG.timeout!),
    });

    if (!response.ok) {
      const duration = Date.now() - startTime;
      // 尝试读取响应体中的错误信息
      let errorBody = '';
      let errorMessage = response.statusText;
      try {
        const errorJson = await response.json();
        if (errorJson.error) {
          errorMessage = errorJson.error.message || errorJson.error.code || response.statusText;
          errorBody = JSON.stringify(errorJson.error);
        }
      } catch (e) {
        // 如果无法解析 JSON，尝试读取文本
        try {
          errorBody = await response.text();
        } catch (e2) {
          // 忽略读取错误
        }
      }
      analytics.trackAPICallFailure({
        endpoint,
        model,
        duration,
        error: errorMessage,
        httpStatus: response.status,
        stream: false,
      });
      const error = new Error(`HTTP ${response.status}: ${errorMessage}`);
      (error as any).apiErrorBody = errorBody;
      (error as any).httpStatus = response.status;
      throw error;
    }

    // 处理非流式响应
    const result = await response.json();
    const duration = Date.now() - startTime;

    analytics.trackAPICallSuccess({
      endpoint,
      model,
      duration,
      responseLength: result.choices?.[0]?.message?.content?.length,
      stream: false,
    });

    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    analytics.trackAPICallFailure({
      endpoint,
      model,
      duration,
      error: errorMessage,
      stream: false,
    });

    throw error;
  }
}

/**
 * 流式 API 调用函数
 *
 * 在主线程直接使用 fetch 发起流式请求。
 */
export async function callApiStreamRaw(
  config: GeminiConfig,
  messages: GeminiMessage[],
  onChunk?: (content: string) => void,
  signal?: AbortSignal
): Promise<GeminiResponse> {
  if (isGoogleGenerateContentProtocol(config)) {
    return callGoogleGenerateContentRaw(config, messages, {
      stream: true,
      onChunk,
      signal,
    });
  }

  return callApiStreamDirect(config, messages, onChunk, signal);
}

// callApiStreamViaSW 已移除

/**
 * 使用 fetch 发送流式 API 请求
 */
async function callApiStreamDirect(
  config: GeminiConfig,
  messages: GeminiMessage[],
  onChunk?: (content: string) => void,
  signal?: AbortSignal
): Promise<GeminiResponse> {
  const startTime = Date.now();
  const model = config.modelName || 'gemini-3-pro-image-preview-vip';
  const endpoint = '/chat/completions';

  console.log('[callApiStreamDirect] 发起 direct fetch 请求:', {
    model,
    baseUrl: config.baseUrl,
    hasApiKey: !!config.apiKey,
    messageCount: messages.length,
  });

  // Track API call start
  analytics.trackAPICallStart({
    endpoint,
    model,
    messageCount: messages.length,
    stream: true,
  });

  const headers = {
    'Content-Type': 'application/json',
  };
  const data = {
    model,
    messages,
    presence_penalty: 0,
    temperature: 0.5,
    top_p: 1,
    stream: true,
  };

  // Handle signal merging (timeout + user cancel)
  const controller = new AbortController();
  const timeoutMs = config.timeout || DEFAULT_CONFIG.timeout!;
  const timeoutId = setTimeout(() => controller.abort(new Error('Timeout')), timeoutMs);
  
  if (signal) {
    if (signal.aborted) {
      clearTimeout(timeoutId);
      controller.abort(signal.reason);
    } else {
      signal.addEventListener('abort', () => {
        clearTimeout(timeoutId);
        controller.abort(signal.reason);
      });
    }
  }

  try {
    const response = await providerTransport.send(buildProviderContext(config), {
      path: endpoint,
      method: 'POST',
      headers,
      body: JSON.stringify(data),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const duration = Date.now() - startTime;
      // 尝试读取响应体中的错误信息
      let errorBody = '';
      let errorMessage = response.statusText;
      try {
        const errorJson = await response.json();
        if (errorJson.error) {
          errorMessage = errorJson.error.message || errorJson.error.code || response.statusText;
          errorBody = JSON.stringify(errorJson.error);
        }
      } catch (e) {
        // 如果无法解析 JSON，尝试读取文本
        try {
          errorBody = await response.text();
        } catch (e2) {
          // 忽略读取错误
        }
      }
      analytics.trackAPICallFailure({
        endpoint,
        model,
        duration,
        error: errorMessage,
        httpStatus: response.status,
        stream: true,
      });
      const error = new Error(`HTTP ${response.status}: ${errorMessage}`);
      (error as any).apiErrorBody = errorBody;
      (error as any).httpStatus = response.status;
      throw error;
    }

    // 处理流式响应
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('无法获取响应流');
    }

    const decoder = new TextDecoder();
    let fullContent = '';
    let streamDone = false;
    let lineBuffer = ''; // 缓冲跨 chunk 的不完整行

    try {
      while (!streamDone) {
        const { done, value } = await reader.read();
        if (done) {
          // console.log('[StreamAPI] Stream ended (done=true)');
          streamDone = true;
          continue;
        }

        const chunk = decoder.decode(value, { stream: true });
        // 将缓冲区内容与新 chunk 拼接后再按行分割
        const combined = lineBuffer + chunk;
        const lines = combined.split('\n');
        // 最后一行可能不完整，暂存到 buffer
        lineBuffer = lines.pop() || '';

        for (const line of lines) {
          const trimmedLine = line.trim();
          if (trimmedLine.startsWith('data: ')) {
            const data = trimmedLine.slice(6).trim();
            if (data === '[DONE]') {
              // console.log('[StreamAPI] Received [DONE] signal');
              break;
            }

            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) {
                fullContent += content;
                if (onChunk) {
                  // 返回累积的所有数据，而不是只返回新增的 chunk
                  onChunk(fullContent);
                }
              }
            } catch (e) {
              // 忽略解析错误的数据块（极端情况下单行内的 JSON 仍可能不完整）
              // console.warn('解析流式数据块失败:', e);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    const duration = Date.now() - startTime;

    // Log full content for debugging incomplete responses
    // console.log('[StreamAPI] Stream completed, full content length:', fullContent.length);
    // console.log('[StreamAPI] Full response content:', fullContent);

    // Check for incomplete response patterns
    const hasGeneratingText = fullContent.includes('正在生成') || fullContent.includes('generating');
    const hasImageUrl = fullContent.includes('![') && fullContent.includes('](http');

    if (hasGeneratingText && !hasImageUrl) {
      console.warn('[StreamAPI] Warning: Response contains "generating" text but no image URL - response may be incomplete');
    }

    analytics.trackAPICallSuccess({
      endpoint,
      model,
      duration,
      responseLength: fullContent.length,
      stream: true,
    });

    // 返回标准格式的响应
    return {
      choices: [{
        message: {
          role: 'assistant',
          content: fullContent
        }
      }]
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    analytics.trackAPICallFailure({
      endpoint,
      model,
      duration,
      error: errorMessage,
      stream: true,
    });

    throw error;
  }
}

/**
 * 视频生成专用的流式API调用函数
 */
export async function callVideoApiStreamRaw(
  config: GeminiConfig,
  messages: GeminiMessage[],
  options: VideoGenerationOptions = {}
): Promise<GeminiResponse> {
  const startTime = Date.now();
  const model = config.modelName || VIDEO_DEFAULT_CONFIG.modelName || 'veo3';
  const endpoint = '/chat/completions';

  // Track API call start
  analytics.trackAPICallStart({
    endpoint,
    model,
    messageCount: messages.length + 1, // +1 for system message
    stream: true,
  });

  const headers = {
    'Content-Type': 'application/json',
  };

  // 添加系统消息，参考你提供的接口参数
  const systemMessage: GeminiMessage = {
    role: 'user',
    content: [{
      type: 'text',
      text: `You are Video Creator.\nCurrent model: ${model}\nCurrent time: ${new Date().toLocaleString()}\nLatex inline: $x^2$\nLatex block: $e=mc^2$`
    }]
  };

  const data = {
    max_tokens: options.max_tokens || 1024,
    model,
    temperature: options.temperature || 0.5,
    top_p: options.top_p || 1,
    presence_penalty: options.presence_penalty || 0,
    frequency_penalty: options.frequency_penalty || 0,
    messages: [systemMessage, ...messages],
    stream: true,
  };

  try {
    const response = await providerTransport.send(buildProviderContext(config), {
      path: endpoint,
      method: 'POST',
      headers,
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(config.timeout || VIDEO_DEFAULT_CONFIG.timeout!),
    });

    if (!response.ok) {
      const duration = Date.now() - startTime;
      // 尝试读取响应体中的错误信息
      let errorBody = '';
      let errorMessage = response.statusText;
      try {
        const errorJson = await response.json();
        if (errorJson.error) {
          errorMessage = errorJson.error.message || errorJson.error.code || response.statusText;
          errorBody = JSON.stringify(errorJson.error);
        }
      } catch (e) {
        // 如果无法解析 JSON，尝试读取文本
        try {
          errorBody = await response.text();
        } catch (e2) {
          // 忽略读取错误
        }
      }
      analytics.trackAPICallFailure({
        endpoint,
        model,
        duration,
        error: errorMessage,
        httpStatus: response.status,
        stream: true,
      });
      const error = new Error(`HTTP ${response.status}: ${errorMessage}`);
      (error as any).apiErrorBody = errorBody;
      (error as any).httpStatus = response.status;
      throw error;
    }

    // 处理流式响应
    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('无法获取响应流');
    }

    const decoder = new TextDecoder();
    let fullContent = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data === '[DONE]') {
              break;
            }

            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) {
                fullContent += content;
              }
            } catch (e) {
              // 忽略解析错误的数据块
              console.warn('解析流式数据块失败:', e);
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    const duration = Date.now() - startTime;
    analytics.trackAPICallSuccess({
      endpoint,
      model,
      duration,
      responseLength: fullContent.length,
      stream: true,
    });

    // 返回标准格式的响应
    return {
      choices: [{
        message: {
          role: 'assistant',
          content: fullContent
        }
      }]
    };
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    analytics.trackAPICallFailure({
      endpoint,
      model,
      duration,
      error: errorMessage,
      stream: true,
    });

    throw error;
  }
}

/**
 * API 调用（不再重试）
 */
export async function callApiWithRetry(
  config: GeminiConfig,
  messages: GeminiMessage[],
): Promise<GeminiResponse> {
  // 直接调用，不再重试
  return callApiRaw(config, messages);
}
