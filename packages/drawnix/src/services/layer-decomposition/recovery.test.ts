import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { recoverLayerPayload } from './recovery';
import type { AdapterContext } from '../model-adapters/types';
const mocks = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('../model-adapters/context', () => ({
  sendAdapterRequest: mocks.send,
}));
const context: AdapterContext = {
  baseUrl: 'https://api.tu-zi.com',
  operation: 'image',
};
const result = {
  request_id: 'req-layer',
  status: 'succeeded',
  data: [
    { url: 'https://a.test/base', z_index: 0 },
    {
      url: 'https://a.test/text',
      z_index: 1,
      bounding_box: {
        absolute: [0, 0, 100, 100],
        normalized: [0, 0, 1000, 1000],
      },
      text_recognition: { text: 'SALE' },
    },
  ],
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());
it('polls existing results with GET and preserves full layer metadata', async () => {
  mocks.send
    .mockResolvedValueOnce(
      Response.json({
        request_id: 'req-layer',
        status: 'processing_or_not_found',
      })
    )
    .mockResolvedValueOnce(Response.json(result));
  const promise = recoverLayerPayload(context, 'req-layer');
  await vi.advanceTimersByTimeAsync(5000);
  expect(await promise).toMatchObject({
    ...result,
    id: 'seedream55-req-layer',
  });
  expect(mocks.send).toHaveBeenCalledTimes(2);
  for (const [ctx, request] of mocks.send.mock.calls) {
    expect(ctx).toBe(context);
    expect(request).toMatchObject({
      method: 'GET',
      path: '/images/generations/result',
      query: { request_id: 'req-layer' },
    });
    expect(request.body).toBeUndefined();
  }
});
it.each([401, 403, 404])('stops on HTTP %s without retries', async (status) => {
  mocks.send.mockResolvedValue(Response.json({}, { status }));
  await expect(recoverLayerPayload(context, 'req-layer')).rejects.toThrow(
    `HTTP ${status}`
  );
  expect(mocks.send).toHaveBeenCalledOnce();
});
it.each([
  [{ ...result, request_id: 'other' }, 'ID 不匹配'],
  [{ ...result, status: 'failed' }, '上游分层任务失败'],
  [{ ...result, status: 'other' }, '无法识别'],
  [{ ...result, data: [{ url: 'https://a.test/legacy' }] }, '缺少分层元数据'],
])('rejects terminal or incomplete payloads', async (payload, message) => {
  mocks.send.mockResolvedValue(Response.json(payload));
  await expect(recoverLayerPayload(context, 'req-layer')).rejects.toThrow(
    message
  );
  expect(mocks.send).toHaveBeenCalledOnce();
});
it('retries transient GET failures within a bounded deadline', async () => {
  mocks.send
    .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    .mockResolvedValueOnce(Response.json({}, { status: 503 }))
    .mockResolvedValueOnce(Response.json(result));
  const promise = recoverLayerPayload(context, 'req-layer');
  await vi.advanceTimersByTimeAsync(10000);
  await expect(promise).resolves.toMatchObject({ status: 'succeeded' });
  expect(mocks.send).toHaveBeenCalledTimes(3);
});
it('stops after timeout and supports cancelling between polls', async () => {
  mocks.send.mockResolvedValue(
    Response.json({
      request_id: 'req-layer',
      status: 'processing_or_not_found',
    })
  );
  const timed = expect(
    recoverLayerPayload(context, 'req-layer', { timeoutMs: 5000 })
  ).rejects.toThrow('超时');
  await vi.advanceTimersByTimeAsync(5000);
  await timed;
  const controller = new AbortController();
  const cancelled = expect(
    recoverLayerPayload(context, 'req-layer', { signal: controller.signal })
  ).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(1);
  controller.abort();
  await cancelled;
  const calls = mocks.send.mock.calls.length;
  await vi.advanceTimersByTimeAsync(30000);
  expect(mocks.send).toHaveBeenCalledTimes(calls);
});
it('does not query an already cancelled attempt', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    recoverLayerPayload(context, 'req-layer', { signal: controller.signal })
  ).rejects.toThrow();
  expect(mocks.send).not.toHaveBeenCalled();
});
it('handles non-JSON HTTP failures without hiding auth errors', async () => {
  mocks.send
    .mockResolvedValueOnce(new Response('unavailable', { status: 503 }))
    .mockResolvedValueOnce(new Response('unauthorized', { status: 401 }));
  const pending = expect(
    recoverLayerPayload(context, 'req-layer')
  ).rejects.toThrow('HTTP 401');
  await vi.advanceTimersByTimeAsync(5000);
  await pending;
  expect(mocks.send).toHaveBeenCalledTimes(2);
});
it('stops on malformed successful JSON', async () => {
  mocks.send.mockResolvedValue(new Response('broken', { status: 200 }));
  await expect(recoverLayerPayload(context, 'req-layer')).rejects.toThrow(
    '无效 JSON'
  );
  expect(mocks.send).toHaveBeenCalledOnce();
});
