import type { GeminiMessage } from '../../utils/gemini-api/types';

export function textCompletionPath(baseUrl: string, submitPath?: string, multimodal = false): string {
  if (submitPath && !['/chat/completions', '/v1/chat/completions', '/responses', '/v1/responses'].includes(submitPath)) return submitPath;
  const url = new URL(baseUrl);
  return url.origin === 'https://api.tu-zi.com'
    ? multimodal ? '/v1/responses' : '/v1/chat/completions'
    : submitPath || '/chat/completions';
}

export function textRequestBody(path: string, body: { model: string; messages: GeminiMessage[]; stream: boolean; max_tokens?: number; response_format?: unknown; temperature?: number; top_p?: number }) {
  if (!/\/responses\/?$/.test(path)) return body;
  const { messages, max_tokens, response_format, ...params } = body;
  const format = response_format as { type?: string; json_schema?: Record<string, unknown> } | undefined;
  return {
    ...params,
    input: messages.map((message) => ({
      role: message.role,
      content: message.content.map((part) => {
        if (part.type === 'text') return { type: message.role === 'assistant' ? 'output_text' : 'input_text', text: part.text || '' };
        if (part.type === 'image_url' && part.image_url?.url) return { type: 'input_image', image_url: part.image_url.url };
        if (part.type === 'inline_data' && part.mimeType.startsWith('image/')) return { type: 'input_image', image_url: `data:${part.mimeType};base64,${part.data}` };
        throw new Error('Responses 文本接口暂不支持此参考内容类型。');
      }),
    })),
    ...(max_tokens !== undefined ? { max_output_tokens: max_tokens } : {}),
    ...(format ? { text: { format: format.type === 'json_schema' ? { ...format.json_schema, type: 'json_schema' } : format } } : {}),
  };
}

// Only the local OpenTu host is known to provide this same-origin proxy.
export const fetchTextCompletion: typeof fetch = (input, init) => {
  if (typeof input === 'string' && typeof window !== 'undefined' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)) {
    const url = new URL(input, window.location.origin);
    if (url.origin === 'https://api.tu-zi.com' && ['/v1/chat/completions', '/v1/responses'].includes(url.pathname)) {
      return fetch(`/__opentu_tuzi_session__${url.pathname}${url.search}`, init);
    }
  }
  return fetch(input, init);
};

export function extractCompletionText(payload: unknown): string {
  const data = payload as {
    error?: { message?: string } | string;
    status?: string;
    incomplete_details?: { reason?: string };
    output_text?: string;
    output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string; refusal?: string }> }>;
    choices?: Array<{ message?: { content?: unknown; refusal?: string }; finish_reason?: string }>;
  } | null;
  if (data?.error) {
    throw new Error(typeof data.error === 'string' ? data.error : data.error.message || 'Text API returned an error');
  }
  if (data?.status === 'failed' || data?.status === 'cancelled') throw new Error(`Responses 请求状态：${data.status}`);
  const choice = data?.choices?.[0];
  const content = choice?.message?.content;
  const responseParts = data?.output?.filter((item) => item.type === 'message').flatMap((item) => item.content || []);
  const responseText = data?.output_text || responseParts?.filter((part) => part.type === 'output_text').map((part) => part.text || '').join('');
  const text = responseText || (typeof content === 'string' ? content : Array.isArray(content)
    ? content.filter((part) => part?.type === 'text' && typeof part.text === 'string').map((part) => part.text).join('')
    : '');
  if (!text.trim()) {
    throw new Error(choice?.message?.refusal || responseParts?.find((part) => part.type === 'refusal')?.refusal || (choice?.finish_reason === 'length' || data?.incomplete_details?.reason === 'max_output_tokens'
      ? '文本输出达到 token 上限，但没有返回正文；请提高最大输出 token 后重试。'
      : '文本接口未返回有效正文，请检查模型是否支持当前接口和图片输入。'));
  }
  return text;
}

export function safeTextError(error: unknown, secrets: string[] = []): Error {
  let message = error instanceof Error ? error.message : '文本生成失败';
  for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length)) {
    message = message.split(secret).join('[redacted]');
    message = message.split(encodeURIComponent(secret)).join('[redacted]');
  }
  message = message.replace(/\bBearer\s+[^\s"',;]+/gi, 'Bearer [redacted]')
    .replace(/\bsk-[a-zA-Z0-9_-]+/g, '[redacted]');
  return new Error(message);
}
