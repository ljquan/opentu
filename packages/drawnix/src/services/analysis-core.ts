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
import { collectJsonSources } from '../utils/llm-json-extractor';
import { resolveInvocationPlanFromRoute } from './provider-routing';

/**
 * 构建分析文本模型配置。Google 模型走 generateContent，其它文本模型保留原 binding。
 */
export async function buildAnalysisTextConfig(
  model?: string,
  modelRef?: ModelRef | null
): Promise<GeminiConfig> {
  await settingsManager.waitForInitialization();

  const routeModel = modelRef || model || null;
  const route = resolveInvocationRoute('text', routeModel);
  const plan = resolveInvocationPlanFromRoute('text', routeModel);

  const isGoogleBinding = plan?.binding.protocol === 'google.generateContent';
  const config: GeminiConfig = {
    apiKey: route.apiKey,
    baseUrl: route.baseUrl,
    modelName: model || route.modelId || 'gemini-2.5-pro',
    authType: plan?.provider.authType || 'bearer',
    providerType: plan?.provider.providerType || 'custom',
    extraHeaders: plan?.provider.extraHeaders,
    protocol: plan?.binding.protocol || null,
    binding: plan?.binding,
    provider: plan?.provider || null,
  };

  if (isGoogleBinding) {
    config.protocol = 'google.generateContent';
    config.binding = {
      ...(plan?.binding || {}),
      protocol: 'google.generateContent',
      baseUrlStrategy: plan?.binding.baseUrlStrategy || 'trim-v1',
      submitPath: plan?.binding.submitPath,
    } as any;
  }

  return validateAndEnsureConfig(config);
}

export const buildGenerateContentConfig = buildAnalysisTextConfig;

/**
 * 从文本中提取顶层 JSON 对象
 */
export function extractJsonObjects(text: string): string[] {
  try {
    return collectJsonSources(text, { kinds: ['object'] });
  } catch {
    return [];
  }
}
