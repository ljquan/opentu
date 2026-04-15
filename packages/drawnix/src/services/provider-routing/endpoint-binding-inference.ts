/**
 * 从 pricing API 的 endpoints 数据推断 binding 配置。
 * 纯函数，将 endpoint path 映射到已有的 protocol/requestSchema 体系。
 */
import type { PricingEndpointInfo } from '../../utils/model-pricing-types';
import type { ProviderModelBinding } from './types';

export interface EndpointBindingHint {
  protocol: ProviderModelBinding['protocol'];
  requestSchema: string;
  responseSchema: string;
  submitPath: string;
  pollPathTemplate?: string;
  baseUrlStrategy?: ProviderModelBinding['baseUrlStrategy'];
  metadata?: ProviderModelBinding['metadata'];
}

interface PathPattern {
  test: (path: string) => boolean;
  hint: (path: string) => EndpointBindingHint;
}

/**
 * 已知 path 模式 → binding hint。顺序重要：首个匹配生效。
 */
const PATH_PATTERNS: PathPattern[] = [
  // Google generateContent（图片/文本）
  {
    test: (p) => /:generateContent$/i.test(p),
    hint: (p) => ({
      protocol: 'google.generateContent',
      requestSchema: 'google.generate-content.image-inline',
      responseSchema: 'google.generate-content.parts',
      submitPath: p,
      baseUrlStrategy: 'trim-v1',
    }),
  },
  // Midjourney
  {
    test: (p) => p.includes('/mj/submit/imagine'),
    hint: () => ({
      protocol: 'mj.imagine',
      requestSchema: 'mj.imagine.base64-array',
      responseSchema: 'mj.task.status',
      submitPath: '/mj/submit/imagine',
      pollPathTemplate: '/mj/task/{taskId}/fetch',
    }),
  },
  // Flux
  {
    test: (p) => /\/flux\/v\d+\//i.test(p),
    hint: (p) => ({
      protocol: 'flux.task',
      requestSchema: 'flux.image.polling-json',
      responseSchema: 'flux.task.status',
      submitPath: p,
      pollPathTemplate: '/flux/v1/get_result?id={taskId}',
    }),
  },
  // Kling video
  {
    test: (p) => /\/kling\/.*\/videos\//i.test(p),
    hint: () => ({
      protocol: 'kling.video',
      requestSchema: 'kling.video.auto-action-json',
      responseSchema: 'kling.video.task',
      submitPath: '/kling/v1/videos/{action}',
      pollPathTemplate: '/kling/v1/videos/{action}/{taskId}',
    }),
  },
  // Suno audio
  {
    test: (p) => /\/suno\//i.test(p),
    hint: () => ({
      protocol: 'tuzi.suno.music',
      requestSchema: 'tuzi.suno.music.submit',
      responseSchema: 'tuzi.suno.task',
      submitPath: '/suno/submit/music',
      pollPathTemplate: '/suno/fetch/{taskId}',
      baseUrlStrategy: 'trim-v1',
      metadata: {
        audio: {
          action: 'music',
          defaultAction: 'music',
          submitPathByAction: {
            music: '/suno/submit/music',
            lyrics: '/suno/submit/lyrics',
          },
        },
      },
    }),
  },
  // OpenAI images/edits
  {
    test: (p) => /\/images\/edits/i.test(p),
    hint: () => ({
      protocol: 'openai.images.generations',
      requestSchema: 'openai.image.basic-json',
      responseSchema: 'openai.image.data',
      submitPath: '/images/edits',
    }),
  },
  // OpenAI images/generations
  {
    test: (p) => /\/images\/generations/i.test(p),
    hint: () => ({
      protocol: 'openai.images.generations',
      requestSchema: 'openai.image.basic-json',
      responseSchema: 'openai.image.data',
      submitPath: '/images/generations',
    }),
  },
  // OpenAI async video（排除 kling 路径）
  {
    test: (p) => /\/videos/i.test(p) && !/\/kling\//i.test(p),
    hint: () => ({
      protocol: 'openai.async.video',
      requestSchema: 'openai.video.form-input-reference',
      responseSchema: 'openai.async.task',
      submitPath: '/videos',
      pollPathTemplate: '/videos/{taskId}',
    }),
  },
  // OpenAI chat completions
  {
    test: (p) => /\/chat\/completions/i.test(p),
    hint: () => ({
      protocol: 'openai.chat.completions',
      requestSchema: 'openai.chat.messages',
      responseSchema: 'openai.chat.choices',
      submitPath: '/chat/completions',
    }),
  },
];

/**
 * 从 pricing endpoints 数据中推断 binding hint。
 * 遍历所有 endpoint，返回首个匹配的 hint，无匹配返回 null。
 */
export function inferBindingHintFromEndpoints(
  endpoints: Record<string, PricingEndpointInfo>
): EndpointBindingHint | null {
  for (const ep of Object.values(endpoints)) {
    if (!ep.path) continue;
    const path = ep.path.trim();
    for (const pattern of PATH_PATTERNS) {
      if (pattern.test(path)) {
        return pattern.hint(path);
      }
    }
  }
  return null;
}

/**
 * 从 pricing endpoints 数据中推断所有匹配的 binding hints（去重 protocol）。
 */
export function inferAllBindingHintsFromEndpoints(
  endpoints: Record<string, PricingEndpointInfo>
): EndpointBindingHint[] {
  const seen = new Set<string>();
  const hints: EndpointBindingHint[] = [];
  for (const ep of Object.values(endpoints)) {
    if (!ep.path) continue;
    const path = ep.path.trim();
    for (const pattern of PATH_PATTERNS) {
      if (pattern.test(path)) {
        const hint = pattern.hint(path);
        if (!seen.has(hint.protocol)) {
          seen.add(hint.protocol);
          hints.push(hint);
        }
        break;
      }
    }
  }
  return hints;
}
