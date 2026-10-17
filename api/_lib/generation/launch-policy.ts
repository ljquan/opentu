import { GenerationGatewayError } from './errors';
import type { CreateGenerationTaskRequest } from './types';

export function publicGenerationEnabled(): boolean {
  return process.env.OPENTU_PUBLIC_GENERATION_ENABLED === 'true';
}

export function assertPublicGenerationEnabled(): void {
  if (!publicGenerationEnabled()) {
    throw new GenerationGatewayError(
      503,
      'GENERATION_PAUSED',
      '生成服务暂未开放'
    );
  }
}

function limit(name: string, fallback: number, maximum: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new GenerationGatewayError(
      503,
      'INVALID_LAUNCH_CONFIGURATION',
      '生成服务额度配置无效'
    );
  }
  return value;
}

export function launchLimits() {
  return {
    globalActive: limit('OPENTU_GENERATION_GLOBAL_CONCURRENCY', 4, 100),
    providerActive: limit('OPENTU_GENERATION_PROVIDER_CONCURRENCY', 2, 50),
    userActive: limit('OPENTU_GENERATION_USER_CONCURRENCY', 1, 10),
    globalDaily: limit('OPENTU_GENERATION_GLOBAL_DAILY_LIMIT', 100, 100000),
    userDaily: limit('OPENTU_GENERATION_USER_DAILY_LIMIT', 10, 10000),
  };
}

export function applyLaunchInputLimits(
  request: CreateGenerationTaskRequest
): void {
  if (!['text', 'image'].includes(request.operation)) {
    throw new GenerationGatewayError(
      501,
      'OPERATION_NOT_MIGRATED',
      '该生成类型暂未开放'
    );
  }
  if (JSON.stringify(request.input).length > 16000) {
    throw new GenerationGatewayError(
      413,
      'LAUNCH_INPUT_LIMIT',
      '当前生成输入超过试运行上限'
    );
  }
  if (request.references.length || request.input.images !== undefined) {
    throw new GenerationGatewayError(
      501,
      'UPLOADS_NOT_MIGRATED',
      '参考文件功能暂未开放'
    );
  }
  if (request.operation === 'text') {
    const maxTokens = request.parameters.maxTokens ?? 2048;
    if (typeof maxTokens !== 'number' || maxTokens > 2048) {
      throw new GenerationGatewayError(
        400,
        'LAUNCH_OUTPUT_LIMIT',
        '当前文本输出上限为 2048 tokens'
      );
    }
    request.parameters = { ...request.parameters, maxTokens };
  } else {
    const n = request.parameters.n ?? 1;
    const quality = request.parameters.quality ?? 'low';
    const size = request.parameters.size ?? '1024x1024';
    if (
      n !== 1 ||
      !['low', 'standard'].includes(String(quality)) ||
      size !== '1024x1024'
    ) {
      throw new GenerationGatewayError(
        400,
        'LAUNCH_OUTPUT_LIMIT',
        '当前仅开放单张 1024x1024 标准或低质量图片'
      );
    }
    request.parameters = { ...request.parameters, n, quality, size };
  }
}
