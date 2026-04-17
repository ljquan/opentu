/**
 * 分析服务共享工具函数
 *
 * 供 music-analysis-service 和 video-analysis-service 复用。
 */

import {
  resolveInvocationRoute,
  settingsManager,
  type ModelRef,
} from '../utils/settings-manager';
import { validateAndEnsureConfig } from '../utils/gemini-api/auth';
import type { GeminiConfig } from '../utils/gemini-api/types';
import { resolveInvocationPlanFromRoute } from './provider-routing';

/**
 * 构建 google.generateContent 协议的配置
 */
export async function buildGenerateContentConfig(
  model?: string,
  modelRef?: ModelRef | null
): Promise<GeminiConfig> {
  await settingsManager.waitForInitialization();

  const routeModel = modelRef || model || null;
  const route = resolveInvocationRoute('text', routeModel);
  const plan = resolveInvocationPlanFromRoute('text', routeModel);

  const config: GeminiConfig = {
    apiKey: route.apiKey,
    baseUrl: route.baseUrl,
    modelName: model || route.modelId || 'gemini-2.5-pro',
    authType: plan?.provider.authType || 'bearer',
    providerType: plan?.provider.providerType || 'custom',
    extraHeaders: plan?.provider.extraHeaders,
    protocol: 'google.generateContent',
    binding: {
      ...(plan?.binding || {}),
      protocol: 'google.generateContent',
      baseUrlStrategy: 'trim-v1',
      submitPath: undefined,
    } as any,
    provider: plan?.provider || null,
  };

  return validateAndEnsureConfig(config);
}

/**
 * 从文本中提取顶层 JSON 对象
 */
export function extractJsonObjects(text: string): string[] {
  const results: string[] = [];
  let depth = 0;
  let start = -1;

  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (text[i] === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        results.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return results;
}
