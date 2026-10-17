/* @vitest-environment jsdom */
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createGatewayTask: vi.fn(),
  updateStatus: vi.fn(),
  updateRemoteId: vi.fn(),
  completeTask: vi.fn(),
  cacheRemoteUrls: vi.fn(),
}));

vi.mock('../generation-task-gateway-api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../generation-task-gateway-api')>(),
  createGatewayTask: mocks.createGatewayTask,
}));
vi.mock('./task-storage-writer', () => ({
  taskStorageWriter: {
    updateStatus: mocks.updateStatus,
    updateRemoteId: mocks.updateRemoteId,
    completeTask: mocks.completeTask,
  },
}));
vi.mock('./fallback-utils', async (importOriginal) => ({
  ...await importOriginal<typeof import('./fallback-utils')>(),
  cacheRemoteUrls: mocks.cacheRemoteUrls,
}));

import { FallbackMediaExecutor } from './fallback-executor';

beforeEach(() => {
  mocks.createGatewayTask.mockReset().mockResolvedValue({
    id: 'server-task-1', status: 'succeeded',
    result: { images: [{ url: 'https://cdn.example/image.png' }] },
  });
  mocks.updateStatus.mockReset().mockResolvedValue(true);
  mocks.updateRemoteId.mockReset().mockResolvedValue(true);
  mocks.completeTask.mockReset().mockResolvedValue(true);
  mocks.cacheRemoteUrls.mockReset().mockResolvedValue(['/__aitu_cache__/image/result.png']);
});

describe('managed canvas generation', () => {
  it('submits image work through the server gateway and writes the result', async () => {
    expect(import.meta.env.VITE_OPENTU_MANAGED_GENERATION).toBe('true');
    const onGatewayTaskCreated = vi.fn();
    await new FallbackMediaExecutor().generateImage({
      taskId: 'local-1', requestId: 'request-1', prompt: '产品海报',
      model: 'gpt-image-2', size: '1:1', quality: 'standard',
    }, { onGatewayTaskCreated });

    expect(mocks.createGatewayTask).toHaveBeenCalledWith(
      expect.objectContaining({ operation: 'image', parameters: { size: '1024x1024', quality: 'standard', n: 1 } }),
      expect.stringMatching(/^opentu-request-1/)
    );
    expect(onGatewayTaskCreated).toHaveBeenCalledWith('server-task-1');
    expect(mocks.completeTask).toHaveBeenCalledWith('local-1', expect.objectContaining({ url: '/__aitu_cache__/image/result.png' }), 'request-1', expect.any(Object));
  });
});
