import { describe, expect, it } from 'vitest';
import { managedImageIdempotencyKey, managedImageTaskBody } from './generation-task-gateway-api';

describe('managed image gateway contract', () => {
  it('uses the server launch limits for a square image', () => {
    expect(managedImageTaskBody({ taskId: 'local-1', prompt: '产品海报', modelId: 'gpt-image-2', size: '1:1', quality: 'standard' })).toEqual({
      modelId: 'gpt-image-2',
      operation: 'image',
      input: { prompt: '产品海报' },
      parameters: { size: '1024x1024', quality: 'standard', n: 1 },
      references: [],
      context: { parentTaskId: 'local-1' },
    });
  });

  it('keeps retries on one valid idempotency key', () => {
    expect(managedImageIdempotencyKey('request-1')).toBe(managedImageIdempotencyKey('request-1'));
    expect(managedImageIdempotencyKey('request-1')).toMatch(/^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/);
  });
});
