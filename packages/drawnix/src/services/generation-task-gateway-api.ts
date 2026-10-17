export type GatewayTask = {
  id: string; modelId: string; operation: 'text' | 'image'; status: string;
  result: Record<string, unknown> | null;
  error: { code: string; message: string; retryable: boolean } | null;
};

function message(payload: unknown, fallback: string): string {
  const value = payload as { error?: { message?: string }; message?: string } | null;
  return value?.error?.message || value?.message || fallback;
}

async function request(path: string, init: RequestInit = {}): Promise<GatewayTask> {
  const response = await fetch(`/api/generation/tasks${path}`, {
    ...init, credentials: 'include',
    headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(message(payload, `生成请求失败 (${response.status})`));
  const task = (payload as { data?: GatewayTask } | null)?.data;
  if (!task?.id || typeof task.status !== 'string') throw new Error('服务端任务响应格式无效');
  return task;
}

export function createGatewayTask(body: Record<string, unknown>, key: string): Promise<GatewayTask> {
  return request('', { method: 'POST', headers: { 'Idempotency-Key': key }, body: JSON.stringify(body) });
}
export function managedImageTaskBody(input: {
  taskId: string; prompt: string; modelId: string; size?: string; quality?: string;
}): Record<string, unknown> {
  const size = input.size === '1:1' || input.size === '1x1'
    ? '1024x1024'
    : input.size || '1024x1024';
  return {
    modelId: input.modelId,
    operation: 'image',
    input: { prompt: input.prompt },
    parameters: { size, quality: input.quality || 'low', n: 1 },
    references: [],
    context: { parentTaskId: input.taskId },
  };
}
export function managedImageIdempotencyKey(requestId: string): string {
  return `opentu-${requestId}`.slice(0, 120).padEnd(16, '0');
}
export function getGatewayTask(id: string): Promise<GatewayTask> { return request(`/${encodeURIComponent(id)}`); }
export function cancelGatewayTask(id: string): Promise<GatewayTask> { return request(`/${encodeURIComponent(id)}/cancel`, { method: 'POST' }); }
export async function waitForGatewayTask(id: string, signal?: AbortSignal): Promise<GatewayTask> {
  for (;;) {
    if (signal?.aborted) throw new DOMException('任务已取消', 'AbortError');
    const task = await getGatewayTask(id);
    if (['succeeded', 'failed', 'cancelled'].includes(task.status)) return task;
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(resolve, 1200);
      signal?.addEventListener('abort', () => { window.clearTimeout(timer); reject(new DOMException('任务已取消', 'AbortError')); }, { once: true });
    });
  }
}
