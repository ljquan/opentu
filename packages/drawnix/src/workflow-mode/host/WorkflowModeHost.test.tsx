// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkflowModeHost } from './WorkflowModeHost';
import { readModelDefaults } from './model-defaults';
import { MODEL_DEFAULTS_REQUEST } from '../shared/model-defaults';
import { GENERATE_REQUEST, GENERATE_RESPONSE, GENERATE_CANCEL, OPEN_PROVIDER_SETTINGS, NATIVE_MODELS_RESPONSE } from '../shared/generation-bridge';
import { readNativeModels } from './native-models';
import { generateNative } from './native-generation';

vi.mock('./native-generation', () => ({ generateNative: vi.fn() }));
vi.mock('./native-models', () => ({ readNativeModels: vi.fn().mockResolvedValue({ channels: [], defaults: { image: '', video: '', text: '', audio: '' }, warnings: [] }) }));

vi.mock('./model-defaults', () => ({
  readModelDefaults: vi.fn().mockResolvedValue({
    channels: [],
    defaults: { image: '', video: '', text: '', audio: '' },
    warnings: [],
  }),
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
describe('WorkflowModeHost', () => {
  it('opens the exact native provider only for the embedded frame and refreshes on return', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => 'opentu-workflow-app' }));
    const edit = vi.fn();
    const view = render(<WorkflowModeHost open onExit={() => undefined} onOpenProviderSettings={edit} />);
    const frame = (await screen.findByTitle('Infinite Canvas 工作流')) as HTMLIFrameElement;
    const send = (origin: string, source: Window | null, profileId?: string) => window.dispatchEvent(new MessageEvent('message', { origin, source, data: {type: OPEN_PROVIDER_SETTINGS, profileId} }));
    send('https://foreign.test', frame.contentWindow, 'p');
    send(window.location.origin, window, 'p');
    expect(edit).not.toHaveBeenCalled();
    send(window.location.origin, frame.contentWindow, 'p');
    expect(edit).toHaveBeenLastCalledWith('p');
    send(window.location.origin, frame.contentWindow);
    expect(edit).toHaveBeenLastCalledWith(undefined);
    const post = vi.spyOn(frame.contentWindow!, 'postMessage');
    view.rerender(<WorkflowModeHost open={false} onExit={() => undefined} onOpenProviderSettings={edit} />);
    view.rerender(<WorkflowModeHost open onExit={() => undefined} onOpenProviderSettings={edit} />);
    await waitFor(() => expect(post).toHaveBeenCalledWith(expect.objectContaining({type: NATIVE_MODELS_RESPONSE}), window.location.origin));
    expect(readNativeModels).toHaveBeenCalledTimes(4);
    expect(screen.getByTitle('Infinite Canvas 工作流')).toBe(frame);
  });
  it('returns actionable text provider errors to the requesting frame', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => 'opentu-workflow-app' }));
    render(<WorkflowModeHost open onExit={() => undefined} />);
    const frame = (await screen.findByTitle('Infinite Canvas 工作流')) as HTMLIFrameElement;
    const post = vi.spyOn(frame.contentWindow!, 'postMessage');
    vi.mocked(generateNative).mockRejectedValueOnce(new Error('HTTP 403: model unavailable sk-secret'));
    window.dispatchEvent(new MessageEvent('message', { origin: window.location.origin, source: frame.contentWindow, data: {
      type: GENERATE_REQUEST, requestId: 'text-error', payload: { capability: 'text', channelId: 'native', model: 'gpt-5.5', prompt: 'test', images: [] },
    } }));
    await waitFor(() => expect(post).toHaveBeenCalledWith({ type: GENERATE_RESPONSE, requestId: 'text-error', error: 'HTTP 403: model unavailable [redacted]' }, window.location.origin));
  });
  it('correlates generation replies, rejects foreign sources and forwards cancellation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, text: async () => 'opentu-workflow-app' }));
    render(<WorkflowModeHost open onExit={() => undefined} />);
    const frame = (await screen.findByTitle('Infinite Canvas 工作流')) as HTMLIFrameElement;
    const post = vi.spyOn(frame.contentWindow!, 'postMessage');
    const send = (type: string, requestId: string, origin = window.location.origin) => window.dispatchEvent(new MessageEvent('message', { origin, source: frame.contentWindow, data: { type, requestId, payload: { capability: 'image', channelId: 'native', model: 'm', prompt: 'test', images: [] } } }));
    vi.mocked(generateNative).mockResolvedValueOnce({ urls: ['https://example.test/result.png'] });
    send(GENERATE_REQUEST, 'foreign', 'https://foreign.test');
    expect(generateNative).not.toHaveBeenCalled();
    send(GENERATE_REQUEST, 'first');
    await waitFor(() => expect(post).toHaveBeenCalledWith({ type: GENERATE_RESPONSE, requestId: 'first', payload: { urls: ['https://example.test/result.png'] } }, window.location.origin));
    let runningSignal: AbortSignal | undefined;
    vi.mocked(generateNative).mockImplementationOnce((_request, signal) => {
      runningSignal = signal;
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))));
    });
    send(GENERATE_REQUEST, 'second');
    send(GENERATE_CANCEL, 'second');
    expect(runningSignal?.aborted).toBe(true);
  });
  it('only responds to the embedded frame on the same origin', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue({
          ok: true,
          text: async () => 'opentu-workflow-app',
        })
    );
    render(<WorkflowModeHost open onExit={() => undefined} />);
    const frame = (await screen.findByTitle(
      'Infinite Canvas 工作流'
    )) as HTMLIFrameElement;
    const send = (origin: string, source: Window) =>
      window.dispatchEvent(
        new MessageEvent('message', {
          origin,
          source,
          data: { type: MODEL_DEFAULTS_REQUEST },
        })
      );
    send('https://untrusted.test', frame.contentWindow!);
    send(window.location.origin, window);
    expect(readModelDefaults).not.toHaveBeenCalled();
    send(window.location.origin, frame.contentWindow!);
    await waitFor(() => expect(readModelDefaults).toHaveBeenCalledOnce());
  });
  it('loads on demand and preserves the iframe across mode switches', async () => {
    const request = vi
      .fn()
      .mockResolvedValue({ ok: true, text: async () => 'opentu-workflow-app' });
    vi.stubGlobal('fetch', request);
    const exit = vi.fn();
    const view = render(<WorkflowModeHost open={false} onExit={exit} />);
    expect(request).not.toHaveBeenCalled();
    view.rerender(<WorkflowModeHost open onExit={exit} />);
    const frame = await screen.findByTitle('Infinite Canvas 工作流');
    expect(frame.getAttribute('src')).toBe('/workflow-app/index.html#/canvas');
    fireEvent.click(screen.getByRole('button', { name: '返回画布' }));
    expect(exit).toHaveBeenCalledOnce();
    view.rerender(<WorkflowModeHost open={false} onExit={exit} />);
    expect(frame.closest('section')?.hidden).toBe(true);
    view.rerender(<WorkflowModeHost open onExit={exit} />);
    expect(screen.getByTitle('Infinite Canvas 工作流')).toBe(frame);
    expect(request).toHaveBeenCalledOnce();
  });
  it('rejects an OpenTu fallback page and allows retry', async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: async () => '<html>OpenTu</html>',
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => 'opentu-workflow-app',
      });
    vi.stubGlobal('fetch', request);
    render(<WorkflowModeHost open onExit={() => undefined} />);
    await screen.findByText('工作流资源加载失败');
    expect(screen.queryByTitle('Infinite Canvas 工作流')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    await waitFor(() =>
      expect(screen.getByTitle('Infinite Canvas 工作流')).toBeTruthy()
    );
  });
});
